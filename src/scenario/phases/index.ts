// Scenario pipeline phases. Each phase takes an explicit JSON-serializable
// config + GraphQL client + emit callback, streams ScenarioProgress events,
// and returns the ids/context downstream phases need. ScenarioFetcher
// composes them inline; the server exposes each standalone.

// Common's public surface. Most phase-contract plumbing stays internal to
// './common'; phaseDone is public because phase implementations outside this
// directory (the WSDOT report phases) close their slices with it too.
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
