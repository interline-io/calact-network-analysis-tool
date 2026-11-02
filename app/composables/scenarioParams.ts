import { createScenarioDisplay, type ScenarioDisplay } from './scenarioDisplay'
import { createScenarioFilters, type ScenarioFilters } from './scenarioFilters'
import { createScenarioInputs, type ScenarioInputs } from './scenarioInputs'
import type { QuerySource } from './pendingQuery'

// One scenario's parameters: what it fetches, how it filters the results, and
// how it displays them.
export interface ScenarioParams {
  inputs: ScenarioInputs
  filters: ScenarioFilters
  display: ScenarioDisplay
}

// A scenario's parameters, read from and written to one query.
export function createScenarioParams (source: QuerySource): ScenarioParams {
  return {
    inputs: createScenarioInputs(source),
    filters: createScenarioFilters(source),
    display: createScenarioDisplay(source),
  }
}
