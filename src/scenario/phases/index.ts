// Scenario pipeline phases. Each phase takes an explicit JSON-serializable
// config + GraphQL client + emit callback, streams ScenarioProgress events,
// and returns the ids/context downstream phases need. ScenarioFetcher
// composes them inline; the server exposes each standalone.

// Re-export common's public surface. Most phase-contract plumbing (PhaseEmit,
// PhaseOpts, PHASE_MAX_CONCURRENT_REQUESTS) stays internal — the fetch phase
// modules import it directly from './common' — but phaseDone is public: phase
// implementations living outside this directory (the WSDOT report phases)
// close their progress slices with it too.
export {
  createFailureReporter,
  type FailureReporter,
  getSelectedDateRange,
  phaseDone,
  SCENARIO_PHASE_ORDER,
  SCENARIO_PHASE_WEIGHTS,
  type ScenarioPhaseName,
  type FeedVersionRef,
} from './common'
export * from './feed-versions'
export * from './stops'
export * from './routes'
export * from './departures'
export * from './buffer-passes'
export * from './stop-clusters'
export * from './flex'
export * from './census-values'
