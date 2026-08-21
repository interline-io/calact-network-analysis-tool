// Shared client-side consumption of a scenario NDJSON stream: the state refs a
// loading modal reads, a progress folder for receiver callbacks, and a runner
// that fetches a stream and drains it into a receiver.
//
// Split in two on purpose. foldProgress belongs with the receiver, not the
// request: the refetch composables stream into the same shared receiver as the
// main run, so their events fold into the same state through the same
// callback. run() owns one request's lifecycle. Browse and the two WSDOT
// reports each construct their own receiver and share everything else here.

import { ref, type Ref } from 'vue'
import { useToastNotification } from './useToastNotification'
import {
  ScenarioStreamReceiver,
  trackPhaseProgress,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'
import { withCalendarDates } from '~~/src/core'
import type { RequestFailure } from '~~/src/core'

// A live query POSTs `body` (with dates converted to calendar strings); an
// example file omits it and is fetched with a plain GET.
export interface ScenarioStreamRequest {
  url: string
  body?: unknown
}

export interface UseScenarioStreamReturn {
  loadingProgress: Ref<ScenarioProgress | undefined>
  error: Ref<Error | undefined>
  // Requests that failed after all retries. Non-fatal — the run finishes — so
  // this is what tells the user the results are incomplete.
  requestErrors: Ref<RequestFailure[]>
  // Weighted progress-bar state for the loading modal. Accumulated in
  // foldProgress so no events are missed (template-level watchers only sample
  // the latest: several NDJSON lines decoded from one network chunk collapse
  // into a single watcher invocation, dropping the plan announcement).
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  stopDepartureCount: Ref<number>
  // Distinct stops seen with departures, from streams that fold departures
  // server-side and send summary counts. Sticky here so the figure survives a
  // stream that ends without completing.
  stopsWithDepartures: Ref<number>
  // Fold one progress event into the state above. Call from every receiver's
  // onProgress, whichever run or refetch the event came from.
  foldProgress: (progress: ScenarioProgress) => void
  // Reset the state and stream one request into the receiver. Throws on HTTP
  // errors; stream-level failures land in `error` instead.
  run: (receiver: ScenarioDataReceiver, request: ScenarioStreamRequest) => Promise<void>
}

export function useScenarioStream (): UseScenarioStreamReturn {
  const loadingProgress = ref<ScenarioProgress>()
  const error = ref<Error>()
  const requestErrors = ref<RequestFailure[]>([])
  const phasePlan = ref<ScenarioPhaseName[] | undefined>()
  const phaseFractions = ref<Partial<Record<ScenarioPhaseName, number>>>({})
  const stopDepartureCount = ref<number>(0)
  const stopsWithDepartures = ref<number>(0)

  const foldProgress = (progress: ScenarioProgress): void => {
    loadingProgress.value = progress

    const tracked = trackPhaseProgress(
      { plan: phasePlan.value, fractions: phaseFractions.value },
      progress,
    )
    phasePlan.value = tracked.plan
    phaseFractions.value = tracked.fractions

    // Streams that fold departures server-side send running totals instead of
    // the tuples; browse-style streams still count them off the wire.
    if (progress.departureSummary) {
      stopDepartureCount.value = progress.departureSummary.departures
      stopsWithDepartures.value = progress.departureSummary.stopsWithDepartures
    } else {
      stopDepartureCount.value += progress.partialData?.stopDepartures?.length || 0
    }

    if (progress.requestErrors && progress.requestErrors.length > 0) {
      requestErrors.value = [...requestErrors.value, ...progress.requestErrors]
    }

    if (progress.warnings && progress.warnings.length > 0) {
      for (const msg of progress.warnings) {
        useToastNotification().showToast(msg)
      }
    }
  }

  const run = async (receiver: ScenarioDataReceiver, request: ScenarioStreamRequest): Promise<void> => {
    // Clear state left by a prior run so a fresh run starts clean — a stale
    // error would keep the success path (gated on !error) suppressed.
    loadingProgress.value = undefined
    error.value = undefined
    requestErrors.value = []
    stopDepartureCount.value = 0
    stopsWithDepartures.value = 0
    phasePlan.value = undefined
    phaseFractions.value = {}

    const response = request.body === undefined
      ? await fetch(request.url)
      : await fetch(request.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(withCalendarDates(request.body)),
        })
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
    if (!response.body) {
      throw new Error('No response body received')
    }

    const streamer = new ScenarioStreamReceiver()
    const { success } = await streamer.processStream(response.body, receiver)
    // A failure the server managed to report is already in `error`, and its
    // stream then ends without a 'complete' too. Only a stream that stopped
    // without saying anything is the abnormal termination this describes —
    // overwriting a reported cause told the user a census-backend error was
    // an out-of-memory condition.
    if (!success && !error.value) {
      error.value = new Error('Stream ended unexpectedly. The server may have run out of memory. Try a smaller region.')
    }
  }

  return {
    loadingProgress,
    error,
    requestErrors,
    phasePlan,
    phaseFractions,
    stopDepartureCount,
    stopsWithDepartures,
    foldProgress,
    run,
  }
}
