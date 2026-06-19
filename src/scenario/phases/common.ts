// Shared plumbing for scenario phases. Each phase is a pure function over an
// explicit, JSON-serializable config: callable inline by ScenarioFetcher or
// standalone via its own server endpoint, emitting the same ScenarioProgress
// NDJSON envelope either way (the pattern established by buffer-passes).

import type { ScenarioProgress } from '../scenario'

// Phases report progress (and stream partial data) through this callback.
export type PhaseEmit = (progress: ScenarioProgress) => void

export interface PhaseOpts {
  // Per-task (non-fatal) errors: the phase continues processing remaining
  // tasks, mirroring the pre-split TaskQueue behavior. Phase-fatal errors
  // are thrown instead.
  onError?: (error: any) => void
}

// Concurrent GraphQL requests per phase queue.
export const PHASE_MAX_CONCURRENT_REQUESTS = 8

// Phase identities for the progress plan and weights. 'buffers' covers all
// four buffer passes as a single slice. 'stop-clusters' is the #330 transfer-hub
// pass (a separate stop query with nearby_stops neighbors).
export type ScenarioPhaseName = 'feed-versions' | 'stops' | 'routes' | 'departures' | 'buffers' | 'stop-clusters' | 'flex-areas' | 'census-values'

// Pipeline ordering for phase plans and progress display.
export const SCENARIO_PHASE_ORDER: ScenarioPhaseName[] = [
  'feed-versions', 'stops', 'routes', 'departures', 'buffers', 'stop-clusters', 'flex-areas', 'census-values',
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

// Accepts ScenarioConfig or any phase config carrying the date range. Over
// the BFF JSON boundary these are ISO strings at runtime; `.valueOf()` feeds
// `new Date()` either way.
export function getSelectedDateRange (config: { startDate?: Date, endDate?: Date }): Date[] {
  const sd = new Date((config.startDate || new Date()).valueOf())
  const ed = new Date((config.endDate || new Date()).valueOf())
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  return dates
}
