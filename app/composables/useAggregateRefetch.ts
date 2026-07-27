// Debounced census-values refetch on Aggregate-by layer change: recomputes only
// the ACS census geographies/values for the new layer (server-side) into the
// existing receiver, leaving the rest of the scenario untouched. Per-stop
// census_geographies already carry every layer in the dataset, so only the
// census-values map needs refetching. Streaming/abort/debounce machinery lives
// in useStreamingRefetch.

import { computed, ref, watchEffect, type Ref } from 'vue'
import { aggClipNeedsGeometry } from '~~/src/core'
import { useScenarioDisplay } from './useScenarioDisplay'
import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import type { CensusValuesPhaseConfig } from '~~/src/scenario'

// scenarioReceiver is created by useScenarioRun and shared so refetched
// census values land in the same accumulator.
export interface UseAggregateRefetchDeps extends StreamingRefetchDeps {
  // Marked stops from the filtered result. The stop-buffer clip follows the
  // filter, so buffer coverage answers "within reach of the service you
  // selected" rather than of every stop in the query area.
  markedStopIds: Ref<number[]>
}

export function useAggregateRefetch (deps: UseAggregateRefetchDeps): void {
  const { aggregateLayer, showAggAreas, aggClipMode, showStopBuffer } = useScenarioDisplay()
  // The census-values phase pads the fetch bbox by the stop buffer radius, so a
  // radius change (not just a layer change) can shift which edge geographies the
  // map needs — refetch on both.
  const { stopBufferRadius } = useScenarioInputs()

  // Clipped outlines aren't fetched by the initial scenario run, so the first
  // display that draws them costs one refetch. Latched rather than tracked, so
  // hiding the overlay or switching back to unclipped doesn't throw the
  // outlines away and make returning cost another round trip. Both clips
  // arrive together, so queryArea↔buffer is free either way.
  const geometryLatch = ref(false)
  watchEffect(() => {
    const forChoropleth = showAggAreas.value && aggClipNeedsGeometry(aggClipMode.value)
    if (forChoropleth || showStopBuffer.value) {
      geometryLatch.value = true
    }
  })
  const needsGeometry = computed(() => geometryLatch.value)

  // An unfiltered scenario collapses to one sentinel: the initial run already
  // clipped against every stop, and the marked set churns as results stream
  // in, which would otherwise fire a pointless recompute on every load.
  const markedStopKey = computed(() => {
    const marked = deps.markedStopIds.value
    const total = deps.scenarioData.value?.stops.length ?? 0
    return marked.length >= total ? 'all' : marked.join(',')
  })

  useStreamingRefetch(deps, {
    watchSources: [aggregateLayer, stopBufferRadius, needsGeometry, markedStopKey],
    // Reuse the standalone census-values phase endpoint (it re-resolves
    // geographyIds or a plain bbox server-side) rather than a bespoke one.
    endpoint: '/api/scenario/census-values',
    phase: 'census-values',
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
        // Marked only. An empty set means the filter excluded everything, so
        // the clip pass correctly skips and the values stay query-area.
        stopIds: deps.markedStopIds.value,
        includeIntersectionGeometry: needsGeometry.value,
      }
      return body
    },
  })
}
