// Shared plumbing for scenario phases. Each phase is a pure function over an
// explicit, JSON-serializable config: callable inline by ScenarioFetcher or
// standalone via its own server endpoint, emitting the same ScenarioProgress
// NDJSON envelope either way (the pattern established by buffer-passes).

import type { ScenarioConfig, ScenarioProgress } from '../scenario'

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

// The scenario phase registry: one entry per phase, in pipeline order. Adding
// a phase is a single edit here — the name union, the order, the progress
// weight, and the plan all derive from this array.
//
// `enabled` is the single source of truth for whether a config includes the
// phase, driving both the emitted plan and fetchMain's execution gating, so the
// two cannot drift. Routes, departures, and buffers execute inside the stops
// block (they consume its ids), so their predicates must imply the stops
// predicate. 'buffers' covers all four buffer passes as one slice;
// 'stop-clusters' is the transfer-hub pass.
//
// Weights are relative progress-bar slices, normalized by the consumer over the
// run's enabled phases. Rough cost ratios — tune from stage timings.
const SCENARIO_PHASES = [
  { name: 'feed-versions', weight: 1, enabled: () => true },
  { name: 'stops', weight: 2, enabled: (c: ScenarioConfig) => c.includeFixedRoute !== false },
  { name: 'routes', weight: 1, enabled: (c: ScenarioConfig) => c.includeFixedRoute !== false },
  { name: 'departures', weight: 10, enabled: (c: ScenarioConfig) => c.includeFixedRoute !== false
    && c.includeDepartures !== false },
  { name: 'buffers', weight: 3, enabled: (c: ScenarioConfig) => c.includeFixedRoute !== false
    && c.includeCensus !== false
    && (c.stopBufferRadius ?? 0) > 0
    && !!c.tableDatasetName },
  { name: 'stop-clusters', weight: 2, enabled: (c: ScenarioConfig) => c.includeFixedRoute !== false
    && (c.stopClusterDistance ?? 0) > 0 },
  { name: 'flex-areas', weight: 1, enabled: (c: ScenarioConfig) => c.includeFlexAreas !== false },
  { name: 'census-values', weight: 1, enabled: (c: ScenarioConfig) => c.includeCensus !== false
    && !!c.tableDatasetName
    && !!c.aggregateLayer },
] as const satisfies readonly {
  name: string
  weight: number
  enabled: (config: ScenarioConfig) => boolean
}[]

export type ScenarioPhaseName = typeof SCENARIO_PHASES[number]['name']

// Pipeline ordering for phase plans and progress display.
export const SCENARIO_PHASE_ORDER: ScenarioPhaseName[] = SCENARIO_PHASES.map(p => p.name)

// `Object.fromEntries` widens its key type, so the cast restores exhaustiveness.
export const SCENARIO_PHASE_WEIGHTS = Object.fromEntries(
  SCENARIO_PHASES.map(p => [p.name, p.weight]),
) as Record<ScenarioPhaseName, number>

// The enabled phases for a scenario config, in pipeline order.
export function scenarioPhasePlan (config: ScenarioConfig): ScenarioPhaseName[] {
  return SCENARIO_PHASES.filter(p => p.enabled(config)).map(p => p.name)
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
