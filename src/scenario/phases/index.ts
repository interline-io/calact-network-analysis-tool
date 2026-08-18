// Scenario pipeline phases. Each phase takes an explicit JSON-serializable
// config + GraphQL client + emit callback, streams ScenarioProgress events,
// and returns the ids/context downstream phases need. ScenarioFetcher
// composes them inline; server/api/scenario/* exposes each standalone.
// (buffer-passes.ts is the seventh phase; it predates this directory.)

// Re-export only common's public surface. The phase-contract plumbing
// (PhaseEmit, PhaseOpts, phaseDone, PHASE_MAX_CONCURRENT_REQUESTS) stays
// internal — phase modules import it directly from './common'.
export {
  getSelectedDateRange,
  SCENARIO_PHASE_ORDER,
  SCENARIO_PHASE_WEIGHTS,
  type ScenarioPhaseName,
  type FeedVersionRef,
} from './common'
export * from './feed-versions'
export * from './stops'
export * from './routes'
export * from './departures'
export * from './flex'
export * from './census-values'
