// Shared client-side consumption of a scenario NDJSON stream, used by browse
// and both WSDOT reports: the state refs the loading modal reads, foldProgress
// for receiver callbacks (refetches into the shared receiver fold into the
// same state), run() for one run's lifecycle, and runQuery() for the
// modal/toast framing around it.

import { ref, type MaybeRefOrGetter, type Ref } from 'vue'
import { useToastNotification } from './useToastNotification'
import { useOpenStream, type FetchMode } from './useOpenStream'
import {
  ScenarioStreamReceiver,
  trackPhaseProgress,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'
import { gateReceiver, type RequestFailure } from '~~/src/core'
import type { StreamEndpoint } from '~~/src/stream-runs'

// Stream state and lifecycle for one scenario run at a time.
export interface UseScenarioStreamReturn {
  loadingProgress: Ref<ScenarioProgress | undefined>
  error: Ref<Error | undefined>
  // Requests that failed after all retries; non-fatal, but the results are
  // incomplete and the user has to see that.
  requestErrors: Ref<RequestFailure[]>
  // Weighted progress-bar state, accumulated in foldProgress so no events are
  // missed (template watchers only sample the latest event).
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  stopDepartureCount: Ref<number>
  // The loading modal's visibility, shared with the refetch composables.
  showLoadingModal: Ref<boolean>
  // Fold one progress event into the state above; call from every receiver's
  // onProgress, whichever run or refetch the event came from.
  foldProgress: (progress: ScenarioProgress) => void
  // Reset the state and stream one endpoint's run into the receiver. A new
  // run supersedes any still-draining predecessor: it aborts and its
  // remaining events are dropped, never merged.
  run: (receiver: ScenarioDataReceiver, endpoint: StreamEndpoint, body: unknown) => Promise<void>
  // The modal/toast lifecycle around `fetch`, which returns false when it
  // declined to run (failed validation) — the modal then closes with no toast.
  runQuery: (fetch: () => Promise<boolean>, successToast: string) => Promise<void>
}

export function useScenarioStream (fetchMode: MaybeRefOrGetter<FetchMode>): UseScenarioStreamReturn {
  const openStream = useOpenStream(fetchMode)
  const loadingProgress = ref<ScenarioProgress>()
  const error = ref<Error>()
  const requestErrors = ref<RequestFailure[]>([])
  const phasePlan = ref<ScenarioPhaseName[] | undefined>()
  const phaseFractions = ref<Partial<Record<ScenarioPhaseName, number>>>({})
  const stopDepartureCount = ref<number>(0)
  const showLoadingModal = ref(false)

  const foldProgress = (progress: ScenarioProgress): void => {
    loadingProgress.value = progress

    const tracked = trackPhaseProgress(
      { plan: phasePlan.value, fractions: phaseFractions.value },
      progress,
    )
    phasePlan.value = tracked.plan
    phaseFractions.value = tracked.fractions

    stopDepartureCount.value += progress.partialData?.stopDepartures?.length || 0

    if (progress.requestErrors && progress.requestErrors.length > 0) {
      requestErrors.value = [...requestErrors.value, ...progress.requestErrors]
    }

    if (progress.warnings && progress.warnings.length > 0) {
      for (const msg of progress.warnings) {
        useToastNotification().showToast(msg)
      }
    }
  }

  // Run identity is the run's own AbortController: a new run aborts its
  // predecessor, and everything the old run might still do is gated on its
  // signal.
  //
  // TODO: before direct mode ships, also abort on scope dispose. Otherwise a
  // run outlives its unmounted component, and in direct mode its worker keeps
  // fetching until the run finishes.
  let abort: AbortController | undefined

  const run = async (receiver: ScenarioDataReceiver, endpoint: StreamEndpoint, body: unknown): Promise<void> => {
    abort?.abort()
    const controller = new AbortController()
    abort = controller

    // Clear state left by a prior run so a fresh run starts clean — a stale
    // error would keep the success path (gated on !error) suppressed.
    loadingProgress.value = undefined
    error.value = undefined
    requestErrors.value = []
    stopDepartureCount.value = 0
    phasePlan.value = undefined
    phaseFractions.value = {}

    let stream: ReadableStream<Uint8Array>
    try {
      stream = await openStream(endpoint, body, controller.signal)
    } catch (err) {
      // Superseded runs abort their own fetch; that is not a failure.
      if (controller.signal.aborted) {
        return
      }
      throw err
    }

    // The receiver is gated on run identity, so a superseded run's buffered
    // tail cannot write into its successor's state.
    const { success } = await new ScenarioStreamReceiver().processStream(stream, gateReceiver(receiver, controller.signal))
    if (controller.signal.aborted) {
      return
    }
    // A server-reported failure is already in `error`; only a stream that
    // stopped without saying anything gets the generic cause.
    if (!success && !error.value) {
      error.value = new Error('Stream ended unexpectedly. The server may have run out of memory. Try a smaller region.')
    }
  }

  // Gates the modal/toast framing on being the most recent runQuery
  // invocation — a counter rather than the run's abort signal, because a
  // fetch that declines validation never starts a run at all.
  let queryToken = 0

  const runQuery = async (fetch: () => Promise<boolean>, successToast: string): Promise<void> => {
    const token = ++queryToken
    showLoadingModal.value = true
    let ran: boolean
    try {
      ran = await fetch()
    } catch (err: any) {
      if (token === queryToken) {
        error.value = err
      }
      ran = true
    }
    // A newer invocation owns the modal and toasts now; this one is done.
    if (token !== queryToken) {
      return
    }
    // Declined validation: nothing ran, so there is nothing to report.
    if (!ran) {
      showLoadingModal.value = false
      loadingProgress.value = undefined
      return
    }
    // Request failures hold the modal open too — the run finished, but the
    // results are incomplete and the user has to see that.
    if (!error.value && requestErrors.value.length === 0) {
      useToastNotification().showToast(successToast)
      showLoadingModal.value = false
    }
    loadingProgress.value = undefined
  }

  return {
    loadingProgress,
    error,
    requestErrors,
    phasePlan,
    phaseFractions,
    stopDepartureCount,
    showLoadingModal,
    foldProgress,
    run,
    runQuery,
  }
}
