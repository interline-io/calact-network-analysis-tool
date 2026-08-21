// Debounced census-values refetch on Aggregate-by layer change: recomputes only
// the ACS census geographies/values for the new layer (server-side) into the
// existing receiver, leaving the rest of the scenario untouched. Per-stop
// census_geographies already carry every layer in the dataset, so only the
// census-values map needs refetching. Streaming/abort/debounce machinery lives
// in useStreamingRefetch.

import { ref, watchEffect, type Ref } from 'vue'
import { useScenarioDisplay } from './useScenarioDisplay'
import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import { phaseEnabled, type CensusValuesPhaseConfig } from '~~/src/scenario'

// scenarioReceiver is created by useScenarioRun and shared so refetched
// census values land in the same accumulator.
export interface UseAggregateRefetchDeps extends StreamingRefetchDeps {
  // Marked stops from the filtered result. The stop-buffer clip follows the
  // filter, so buffer coverage answers "within reach of the service you
  // selected" rather than of every stop in the query area.
  markedStopIds: Ref<number[]>
}

export function useAggregateRefetch (deps: UseAggregateRefetchDeps): { refresh: () => void } {
  const { aggregateLayer, showAggAreas, aggClipMode } = useScenarioDisplay()
  // The radius defines the stop buffer clip, so changing it changes the
  // numbers just as much as changing the layer does.
  const { stopBufferRadius } = useScenarioInputs()

  // The scenario run fetches clipped outlines when the display already wants
  // them, so this only has to cover turning a clipped mode on afterwards.
  // Latched, so switching back to unclipped doesn't throw the outlines away
  // and make returning cost another round trip.
  const geometryLatch = ref(false)
  watchEffect(() => {
    if (showAggAreas.value && aggClipMode.value !== 'unclipped') {
      geometryLatch.value = true
    }
  })

  // The marked set churns while results stream in, so watching it would fire a
  // recompute mid-load and fight the main run for the loading modal and the
  // receiver's census slice. Bumped by `refresh()` instead.
  const manualRefresh = ref(0)

  // Until the user asks for it, the clip uses the same stop set the main run
  // did. Sticky once asked, so a later layer or radius change doesn't quietly
  // revert the clip to every stop in the query area.
  const clipToMarkedStops = ref(false)

  useStreamingRefetch(deps, {
    watchSources: [aggregateLayer, stopBufferRadius, geometryLatch, manualRefresh],
    // Reuse the standalone census-values phase endpoint (it re-resolves
    // geographyIds or a plain bbox server-side) rather than a bespoke one.
    endpoint: '/api/scenario/census-values',
    loadingMessage: 'Recomputing aggregation demographics...',
    // Drop the previous layer's geographies up-front so a slow/failed refetch
    // can't leave the choropleth painting the old layer. Only for a layer
    // change: a filter change keeps the same geographies and only moves their
    // numbers, so blanking the map on every checkbox would be worse than a
    // moment of staleness.
    clearBeforeFetch: () => {
      const loaded = deps.scenarioData.value?.censusGeographies?.values().next().value
      return !!loaded && loaded.layer !== aggregateLayer.value
    },
    clearStale: receiver => receiver.clearCensusGeographies(),
    plan: (data, config) => {
      // The phase's own enablement: census excluded at query time, or no
      // layer/dataset to aggregate against — nothing to recompute.
      if (!phaseEnabled('census-values', config)) {
        return 'skip'
      }
      const body: CensusValuesPhaseConfig = {
        bbox: config.bbox,
        geographyIds: config.geographyIds,
        geoDatasetName: config.geoDatasetName,
        // The predicate above guarantees these are set.
        tableDatasetName: config.tableDatasetName!,
        aggregateLayer: config.aggregateLayer!,
        stopBufferRadius: config.stopBufferRadius,
        // An empty marked set means the filter excluded everything, so the
        // clip pass correctly skips and the values stay query-area.
        stopIds: clipToMarkedStops.value
          ? deps.markedStopIds.value
          : data.stops.map(s => s.id),
        includeIntersectionGeometry: geometryLatch.value,
      }
      return body
    },
  })

  return {
    refresh: () => {
      clipToMarkedStops.value = true
      manualRefresh.value++
    },
  }
}
