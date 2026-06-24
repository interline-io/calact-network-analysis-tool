// Debounced census-values refetch on Aggregate-by layer change: recomputes only
// the ACS census geographies/values for the new layer (server-side) into the
// existing receiver, leaving the rest of the scenario untouched. Per-stop
// census_geographies already carry every layer in the dataset, so only the
// census-values map needs refetching. Streaming/abort/debounce machinery lives
// in useStreamingRefetch.

import { useScenarioDisplay } from './useScenarioDisplay'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import type { CensusValuesPhaseConfig } from '~~/src/scenario'

// scenarioReceiver is created by useBufferRefetch and shared so refetched
// census values land in the same accumulator.
export type UseAggregateRefetchDeps = StreamingRefetchDeps

export function useAggregateRefetch (deps: UseAggregateRefetchDeps): void {
  const { aggregateLayer } = useScenarioDisplay()

  useStreamingRefetch(deps, {
    watchSources: [aggregateLayer],
    endpoint: '/api/census-values',
    phase: 'census-values',
    loadingMessage: 'Recomputing aggregation demographics...',
    // Drop the previous layer's geographies up-front so a slow/failed refetch
    // can't leave the choropleth painting the old layer.
    clearBeforeFetch: true,
    clearStale: receiver => receiver.clearCensusGeographies(),
    plan: (data, config) => {
      // Census was excluded at query time; nothing to recompute.
      if (config.includeCensus === false) {
        return 'skip'
      }
      if (!config.aggregateLayer || !config.tableDatasetName) {
        return 'skip'
      }
      const body: CensusValuesPhaseConfig = {
        bbox: config.bbox,
        geographyIds: config.geographyIds,
        geoDatasetName: config.geoDatasetName,
        tableDatasetName: config.tableDatasetName,
        aggregateLayer: config.aggregateLayer,
        stopBufferRadius: config.stopBufferRadius,
      }
      return body
    },
  })
}
