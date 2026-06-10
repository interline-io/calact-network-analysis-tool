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
