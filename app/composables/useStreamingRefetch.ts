// Shared engine for the incremental "recompute one slice" composables (stop
// buffers, stop clusters, aggregation demographics): debounce, abort
// lifecycle, the NDJSON stream into the existing receiver, and loading-modal
// wiring. Each feature supplies its inputs/endpoint/body.

import { markRaw, toValue, watch, onScopeDispose, type MaybeRefOrGetter, type Ref, type ShallowRef, type WatchSource } from 'vue'
import { useOpenStream, type FetchMode } from './useOpenStream'
import {
  ScenarioStreamReceiver,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'
import { gateReceiver, type RequestFailure } from '~~/src/core'
import type { StreamEndpoint } from '~~/src/stream-runs'

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
  // Shared with the main run: failures reported by this refetch's requests land
  // here too, and hold the modal open so an incomplete recompute is visible.
  requestErrors: Ref<RequestFailure[]>
  // Weighted progress-bar state shared with the loading modal; the refetch
  // installs a single-phase plan so the bar tracks just this pass.
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  // Ref-counts concurrent refetches across the buffer/cluster/aggregate
  // composables (they share these refs). The shared loading modal/progress is
  // only torn down when the last refetch finishes, so a sibling that finishes
  // first can't close it mid-load.
  refetchInFlight: Ref<number>
  // Non-zero while the main scenario run is streaming. A refetch started then
  // would interleave with the run's own phases in the shared accumulator, so
  // it waits for the run to finish instead — see the deferral below.
  runInFlight: Ref<number>
  fetchMode: MaybeRefOrGetter<FetchMode>
}

// What a single refetch should do given the current inputs:
//  - an object → the endpoint's request body; stream its run's result in
//  - 'clear'   → drop this feature's accumulated slice (it's now disabled); no call
//  - 'skip'    → do nothing (prerequisites for the feature aren't met)
export type RefetchPlan = object | 'clear' | 'skip'

export interface StreamingRefetchOptions {
  // Reactive inputs whose change triggers a debounced refetch.
  watchSources: WatchSource[]
  endpoint: StreamEndpoint
  loadingMessage: string
  // Decide what this run should do (see RefetchPlan).
  plan: (data: ScenarioData, config: ScenarioConfig) => RefetchPlan
  // Drop this feature's accumulated slice (e.g. clearBufferGeographies /
  // clearStopClusters). Used by the 'clear' plan and, if clearOnError, on failure.
  clearStale: (receiver: ScenarioDataReceiver) => void
  // Clear the stale slice up-front, before the server responds. A getter when
  // only some triggers invalidate what's on screen.
  clearBeforeFetch?: MaybeRefOrGetter<boolean>
  // Clear the stale slice when a recompute fails, so a failed run doesn't strand
  // the previous (now mismatched) results.
  clearOnError?: boolean
}

// Without debounce a slider drag fires one request per step.
const DEBOUNCE_MS = 500

export function useStreamingRefetch (deps: StreamingRefetchDeps, opts: StreamingRefetchOptions): void {
  const openStream = useOpenStream(deps.fetchMode)
  let abort: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  // An input changed while a run was streaming and is waiting for it to finish.
  let deferred = false

  // A new run installs its own receiver, superseding the one a refetch captured
  // when it started. Publishing that one afterwards would put the previous
  // run's results back on screen, so a superseded refetch accumulates in
  // private and never reaches the shared data.
  function publish (receiver: ScenarioDataReceiver): void {
    if (deps.scenarioReceiver.value === receiver) {
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
    }
  }

  function applyClear (receiver: ScenarioDataReceiver): void {
    opts.clearStale(receiver)
    publish(receiver)
  }

  async function refetch (): Promise<void> {
    // A run started while this was waiting out its debounce. Its phases write
    // the same slices, so wait for it rather than interleave with it.
    if (deps.runInFlight.value > 0) {
      deferred = true
      return
    }
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
    if (toValue(opts.clearBeforeFetch)) {
      applyClear(receiver)
    }

    deps.refetchInFlight.value++
    // Only the first refetch of a burst clears; a later one must not discard
    // failures a sibling still in flight has already reported.
    if (deps.refetchInFlight.value === 1) {
      deps.error.value = undefined
      deps.requestErrors.value = []
    }
    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      currentStage: 'ready',
      currentStageMessage: opts.loadingMessage,
    }
    // Cleared now rather than when the endpoint's plan announcement arrives,
    // so the bar doesn't show the previous run's fractions in the meantime.
    deps.phasePlan.value = undefined
    deps.phaseFractions.value = {}

    try {
      const stream = await openStream(opts.endpoint, plan, localAbort.signal)
      const streamer = new ScenarioStreamReceiver()
      // Gated like a run's receiver: a superseded or disposed refetch's abort
      // error and abnormal end would otherwise land in the shared modal state.
      const { success } = await streamer.processStream(stream, gateReceiver(receiver, localAbort.signal))
      if (!success) {
        // Rethrow a server-reported cause rather than overwrite it.
        throw deps.error.value ?? new Error(`Refetch stream from ${opts.endpoint} ended unexpectedly`)
      }
      publish(receiver)
    } catch (err: any) {
      // Superseded or disposed; a stale run must not touch shared state. Keyed
      // off the signal since a mid-stream abort surfaces as a drain failure.
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
      // Only the last refetch standing tears down the shared loading state, and
      // only when nothing failed — a failure report has to stay on screen.
      if (deps.refetchInFlight.value === 0 && deps.requestErrors.value.length === 0) {
        deps.showLoadingModal.value = false
        deps.loadingProgress.value = undefined
      }
    }
  }

  function schedule (): void {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      refetch()
    }, DEBOUNCE_MS)
  }

  // Initial query reads these inputs via `scenarioConfig` directly; this watch
  // only kicks in once a scenario is loaded.
  watch(opts.watchSources, () => {
    // Checked before the receiver/data guard below: on a session's first run
    // there is no data until the first batch arrives, and a change made in that
    // window has to be recorded or it is lost — the run has already captured
    // the old input and nothing would fire once it finishes.
    //
    // Both this refetch and the run's own phases write the same slices of the
    // shared accumulator, and neither can supersede the other's stream — a
    // clear-then-fetch here would be overwritten piecemeal by whatever the run
    // has left to emit, leaving the slice holding both inputs' results at once.
    if (deps.runInFlight.value > 0) {
      deferred = true
      return
    }
    if (!deps.scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    schedule()
  })

  // The run that was in the way has finished; apply what it deferred. The plan
  // is built at that point, so it reflects the inputs as they stand now.
  watch(deps.runInFlight, (inFlight) => {
    if (inFlight === 0 && deferred) {
      deferred = false
      schedule()
    }
  })

  onScopeDispose(() => {
    if (timer) { clearTimeout(timer) }
    abort?.abort()
  })
}
