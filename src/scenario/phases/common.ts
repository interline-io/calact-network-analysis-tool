// Shared plumbing for scenario phases. Each phase is a pure function over an
// explicit, JSON-serializable config: callable inline by ScenarioFetcher or
// standalone via its own server endpoint, emitting the same ScenarioProgress
// NDJSON envelope either way (the pattern established by buffer-passes).

import { parseCalendarDate } from '~~/src/core'
import type { GraphQLClient, RequestFailure } from '~~/src/core'
import type { ScenarioProgress } from '../scenario'

// Phases report progress (and stream partial data) through this callback.
//
// Awaitable: a phase that just emitted a bulk payload should await it, so a
// producer faster than its consumer waits rather than piling unread events on
// the heap. Consumers that only accumulate return void, and awaiting is a
// no-op for them.
export type PhaseEmit = (progress: ScenarioProgress) => void | Promise<void>

export interface PhaseOpts {
  // Per-task (non-fatal) errors: the phase continues processing remaining
  // tasks, mirroring the pre-split TaskQueue behavior. Phase-fatal errors
  // are thrown instead.
  onError?: (error: any) => void
}

// Concurrent GraphQL requests per phase queue.
export const PHASE_MAX_CONCURRENT_REQUESTS = 8

// Phase identities for the progress plan and weights. 'buffers' covers all
// four buffer passes as a single slice. 'stop-clusters' is the transfer-hub
// pass (a separate stop query with nearby_stops neighbors). The 'wsdot-*'
// names are the WSDOT report's own phases (implemented in src/analysis/wsdot);
// only their identity lives here, so plans and progress cover them like any
// fetch phase.
export type ScenarioPhaseName = 'feed-versions' | 'stops' | 'routes' | 'departures' | 'buffers' | 'stop-clusters' | 'flex-areas' | 'census-values' | 'wsdot-levels' | 'wsdot-geographies'

// Pipeline ordering for phase plans and progress display. Report phases come
// after the fetch phases they consume.
export const SCENARIO_PHASE_ORDER: ScenarioPhaseName[] = [
  'feed-versions', 'stops', 'routes', 'departures', 'buffers', 'stop-clusters', 'flex-areas', 'census-values',
  'wsdot-levels', 'wsdot-geographies',
]

// Relative progress-bar weight per phase; the consumer normalizes over the
// run's enabled plan. Rough cost ratios — tune from stage timings as data
// accumulates. Equal weighting is the special case of all-1s.
export const SCENARIO_PHASE_WEIGHTS: Record<ScenarioPhaseName, number> = {
  'feed-versions': 1,
  'stops': 2,
  'routes': 1,
  'departures': 10,
  'buffers': 3,
  'stop-clusters': 2,
  'flex-areas': 1,
  'census-values': 1,
  'wsdot-levels': 1,
  'wsdot-geographies': 3,
}

// Final tick for a phase's progress slice. Also covers phases whose queue
// ended up with zero tasks (a 0/0 counter would otherwise read as fraction 0
// and the slice would never fill).
export function phaseDone (phase: ScenarioPhaseName): { phase: ScenarioPhaseName, completed: number, total: number } {
  return { phase, completed: 1, total: 1 }
}

// The slim feed version identity that stops/flex phases need — full
// FeedVersion objects don't cross the standalone-request boundary.
export interface FeedVersionRef {
  feedOnestopId: string
  feedVersionSha1: string
}

// Accepts ScenarioConfig or any phase config carrying the date range. These
// cross a JSON boundary, where a calendar date travels as `yyyy-MM-dd`;
// parseCalendarDate reads it at local midnight so the day survives whatever
// zone the runtime is in.
export function getSelectedDateRange (config: { startDate?: Date, endDate?: Date }): Date[] {
  const sd = parseCalendarDate(config.startDate) || new Date()
  const ed = parseCalendarDate(config.endDate) || new Date()
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  return dates
}

export interface FailureReporter {
  // Pass as PhaseOpts.onError so an abandoned task is reported too.
  onError: (error: any) => void
  dispose: () => void
}

// Reports every request that failed after exhausting its retries, so a run that
// finishes with holes in it says so. Requests report through the client hook;
// a task that failed for some other reason reports through `onError`, which
// skips failures the hook already covered.
export function createFailureReporter (
  client: GraphQLClient,
  emit: PhaseEmit,
  currentStage: () => ScenarioProgress['currentStage'],
): FailureReporter {
  const reported = new WeakSet<object>()
  const report = (failure: RequestFailure): void => {
    emit({ isLoading: true, currentStage: currentStage(), requestErrors: [failure] })
  }
  const previous = client.onRequestError
  client.onRequestError = (failure, error) => {
    if (error && typeof error === 'object') {
      reported.add(error)
    }
    report(failure)
  }
  return {
    onError (error: any): void {
      if (error && typeof error === 'object' && reported.has(error)) {
        return
      }
      console.warn('[Scenario] task abandoned after error:', error)
      report({
        operation: currentStage(),
        attempts: 1,
        message: error?.message || String(error),
      })
    },
    dispose (): void {
      // Restore rather than clear: reporters nest (the stream envelope
      // installs one for the whole run, ScenarioFetcher its own during the
      // fetch phases), and the outer one must keep covering later stages.
      client.onRequestError = previous
    },
  }
}
