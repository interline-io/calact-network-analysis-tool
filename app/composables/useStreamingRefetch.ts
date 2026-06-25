// Shared engine for the incremental "recompute one slice without re-running the
// whole scenario" composables (stop buffers, stop clusters, aggregation
// demographics). Owns the parts they
// share — debounce, AbortController lifecycle, the NDJSON stream into the existing
// receiver, loading-modal wiring — and leaves each feature its inputs/endpoint/body.

import { markRaw, watch, onScopeDispose, type Ref, type ShallowRef, type WatchSource } from 'vue'
import {
  ScenarioStreamReceiver,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'

export interface StreamingRefetchDeps {
  // Shared with the main fetch path so refetched slices land in the same
  // accumulator. The owner assigns into this after each main scenario fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  scenarioData: Ref<ScenarioData | undefined>
  // ComputedRef satisfies Ref for read access; the refetch only reads it.
  scenarioConfig: Ref<ScenarioConfig>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<any>
  // Weighted progress-bar state shared with the loading modal; the refetch
  // installs a single-phase plan so the bar tracks just this pass.
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  // Ref-counts concurrent refetches across the buffer/cluster/aggregate
  // composables (they share these refs). The shared loading modal/progress is
  // only torn down when the last refetch finishes, so a sibling that finishes
  // first can't close it mid-load.
  refetchInFlight: Ref<number>
}

// What a single refetch should do given the current inputs:
//  - an object → POST it as the request body and stream the result in
//  - 'clear'   → drop this feature's accumulated slice (it's now disabled); no call
//  - 'skip'    → do nothing (prerequisites for the feature aren't met)
export type RefetchPlan = object | 'clear' | 'skip'

export interface StreamingRefetchOptions {
  // Reactive inputs whose change triggers a debounced refetch.
  watchSources: WatchSource[]
  endpoint: string
  // Single-phase plan the loading bar tracks during the refetch.
  phase: ScenarioPhaseName
  loadingMessage: string
  // Decide what this run should do (see RefetchPlan).
  plan: (data: ScenarioData, config: ScenarioConfig) => RefetchPlan
  // Drop this feature's accumulated slice (e.g. clearBufferGeographies /
  // clearStopClusters). Used by the 'clear' plan and, if clearOnError, on failure.
  clearStale: (receiver: ScenarioDataReceiver) => void
  // Clear the stale slice up-front, before the server responds.
  clearBeforeFetch?: boolean
  // Clear the stale slice when a recompute fails, so a failed run doesn't strand
  // the previous (now mismatched) results.
  clearOnError?: boolean
}

// Without debounce a slider drag fires one request per step.
const DEBOUNCE_MS = 500

export function useStreamingRefetch (deps: StreamingRefetchDeps, opts: StreamingRefetchOptions): void {
  let abort: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function applyClear (receiver: ScenarioDataReceiver): void {
    opts.clearStale(receiver)
    deps.scenarioData.value = markRaw(receiver.getCurrentData())
  }

  async function refetch (): Promise<void> {
    const receiver = deps.scenarioReceiver.value
    const data = deps.scenarioData.value
    if (!receiver || !data) {
      return
    }
    const plan = opts.plan(data, deps.scenarioConfig.value)
    // Prerequisites unmet: leave any in-flight request alone and do nothing.
    if (plan === 'skip') {
      return
    }
    abort?.abort()
    const localAbort = new AbortController()
    abort = localAbort
    // Feature disabled: drop its slice, no server call.
    if (plan === 'clear') {
      applyClear(receiver)
      return
    }
    if (opts.clearBeforeFetch) {
      applyClear(receiver)
    }

    deps.refetchInFlight.value++
    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: opts.loadingMessage,
    }
    deps.phasePlan.value = [opts.phase]
    deps.phaseFractions.value = {}

    try {
      const response = await fetch(opts.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(plan),
        signal: localAbort.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${opts.endpoint}`)
      }
      if (!response.body) {
        throw new Error(`No response body from ${opts.endpoint}`)
      }
      const streamer = new ScenarioStreamReceiver()
      const { success } = await streamer.processStream(response.body, receiver)
      if (!success) {
        throw new Error(`Refetch stream from ${opts.endpoint} ended unexpectedly`)
      }
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
    } catch (err: any) {
      // Superseded by a newer refetch (it called abort()) or the scope was disposed.
      // Mid-stream that surfaces as a failed stream drain, not an AbortError, so key
      // off the signal — a stale run touching shared state would clobber the new one.
      if (localAbort.signal.aborted) {
        return
      }
      if (opts.clearOnError) {
        applyClear(receiver)
      }
      deps.error.value = err
    } finally {
      // Every run that incremented must decrement, even a superseded one (whose
      // abort !== localAbort), or the count leaks and the modal never closes.
      deps.refetchInFlight.value = Math.max(0, deps.refetchInFlight.value - 1)
      if (abort === localAbort) {
        abort = undefined
      }
      // Only the last refetch standing tears down the shared loading state.
      if (deps.refetchInFlight.value === 0) {
        deps.showLoadingModal.value = false
        deps.loadingProgress.value = undefined
      }
    }
  }

  // Initial query reads these inputs via `scenarioConfig` directly; this watch
  // only kicks in once a scenario is loaded.
  watch(opts.watchSources, () => {
    if (!deps.scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      refetch()
    }, DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    if (timer) { clearTimeout(timer) }
    abort?.abort()
  })
}
