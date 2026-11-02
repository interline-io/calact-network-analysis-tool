// One scenario's data graph, built from its parameters: the query area, the
// config and filter the parameters describe, the run and refetches that load
// the data, and what the map and reports draw from the filtered result.

import { computed, shallowRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import type { ScenarioParams } from './scenarioParams'
import type { FetchMode } from './useOpenStream'
import { useQueryGeography } from './useQueryGeography'
import { useCensusGeographyLayers } from './useCensusGeographyLayers'
import { useFlexDisplayFeatures } from './useFlexDisplayFeatures'
import { useStopBufferFeatures } from './useStopBufferFeatures'
import { useChoroplethClassification } from './useChoroplethClassification'
import { useScenarioRun } from './useScenarioRun'
import { useBufferRefetch } from './useBufferRefetch'
import { useClusterRefetch } from './useClusterRefetch'
import { useStopCensusRefetch } from './useStopCensusRefetch'
import { useAggregateRefetch } from './useAggregateRefetch'
import {
  geographyLayerQuery,
  stopGeoAggregateCsv,
  routesById,
  parseFvids,
  fareCategoryLabels,
  formatFareAmount,
  type CensusDataset,
} from '~~/src/tl'
import {
  routeTypeNames,
  fmtDate,
  fmtTime,
  SCENARIO_DEFAULTS,
  censusLayerLabels,
  censusApportionGeometry,
  censusApportionRatio,
  type FilterTag,
} from '~~/src/core'
import {
  getSelectedDateRange,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioFilter,
  type ScenarioFilterResult,
} from '~~/src/scenario'

interface UseScenarioDeps {
  scenarioParams: ScenarioParams
  fetchMode: MaybeRefOrGetter<FetchMode>
  // The aggregation area selected on the map, which the choropleth highlights
  selectedAggregationGeoid: Ref<string | null>
}

// A scenario: its query area, its run, and its results.
export function useScenario (deps: UseScenarioDeps) {
  const {
    showAggAreas,
    aggClipMode,
    aggregateLayer,
    choroplethElement,
    shadeByDensity,
    onlyWithStops,
    showStopBuffer,
    hideUnmarked,
    unitSystem,
  } = deps.scenarioParams.display
  const {
    bbox,
    startDate,
    endDate,
    geographyIds,
    geomSource,
    savedGeographies,
    geoDatasetName,
    includeFixedRoute,
    includeFlexAreas,
    includeCensus,
    fvids,
    stopBufferRadius,
    stopBufferLayer,
    clusterDistance,
    pinScenarioInputs,
  } = deps.scenarioParams.inputs
  const {
    startTime,
    endTime,
    selectedRouteTypes,
    selectedAgencies,
    selectedWeekdays,
    selectedWeekdayMode,
    frequencyUnder,
    frequencyOver,
    stopVisitsUnder,
    stopVisitsOver,
    selectedFareCategories,
    fareMax,
    fareMin,
    clusterMaxTransferMinutes,
    flexServicesEnabled,
    flexAdvanceNotice,
    flexAreaTypesSelected,
    flexRiderEligibility,
    flexColorBy,
  } = deps.scenarioParams.filters

  // Scenario data ref - the central scenario data graph, populated by fetchScenario.
  // shallowRef + markRaw: scenario data is huge and updated only by whole-shell
  // replacement (getCurrentData returns a fresh object per batch), so deep
  // proxying would add tracking overhead on every stop/route/departure read
  // without enabling anything.
  const scenarioData = shallowRef<ScenarioData>()
  const scenarioFilterResult = shallowRef<ScenarioFilterResult | undefined>(undefined)

  /////////////////
  // Query area
  /////////////////

  // The query area from a saved or uploaded boundary, and the census
  // geographies it (or the Administrative boundaries mode) names. The geoid
  // check reads the census geographies, so it takes them lazily.
  const {
    savedGeographyAccess,
    savedGeographyLoading,
    savedSelectionRunnable,
    savedSelectionKind,
    accountHasSavedBoundaries,
    queryPolygon,
    queryGeographyIds,
    queryAreaName,
    queryGeographyMessages,
    savedGeographyLoads,
    rememberSavedGeography,
  } = useQueryGeography({
    geomSource,
    savedGeographies,
    geographyIds,
    geoDatasetName,
    censusGeographiesSelected: () => censusGeographiesSelected.value,
  })
  const { censusGeographyLayerOptions, censusGeographiesSelected } = useCensusGeographyLayers(queryGeographyIds, geoDatasetName)

  /////////////////
  // Config and filter
  /////////////////

  const fvidsParsed = computed(() => parseFvids(fvids.value))

  // Map/Set don't survive the BFF JSON boundary — emit Record/array instead.
  const fvidsForConfig = computed(() => {
    const picks = fvidsParsed.value.picks
    const excluded = fvidsParsed.value.excluded
    return {
      feedVersionOverrides: picks.size > 0 ? Object.fromEntries(picks) : undefined,
      excludedFeeds: excluded.size > 0 ? [...excluded] : undefined,
    }
  })

  // Computed properties for config and filter to avoid duplication
  const scenarioConfig = computed((): ScenarioConfig => ({
    geoDatasetName: geoDatasetName.value,
    tableDatasetName: SCENARIO_DEFAULTS.tableDatasetName,
    aggregateLayer: aggregateLayer.value,
    reportName: 'Transit Network Explorer',
    bbox: bbox.value,
    startDate: startDate.value,
    endDate: endDate.value,
    geographyIds: queryGeographyIds.value,
    // An uploaded or saved area, in place of the bbox and geographyIds
    polygon: queryPolygon.value,
    // Data loading toggles from Query tab > Advanced Settings
    includeFixedRoute: includeFixedRoute.value,
    includeFlexAreas: includeFlexAreas.value,
    includeCensus: includeCensus.value,
    includeIntersectionGeometry: showAggAreas.value && aggClipMode.value !== 'unclipped',
    // The census panel splits every geography inside and outside the stop
    // buffers, so the run always asks for the outside clip.
    includeOutsideClip: true,
    // Feed version picks from the Query-tab picker modal (URL-backed).
    feedVersionOverrides: fvidsForConfig.value.feedVersionOverrides,
    excludedFeeds: fvidsForConfig.value.excludedFeeds,
    stopBufferRadius: stopBufferRadius.value,
    stopBufferLayer: stopBufferLayer.value,
    stopClusterDistance: clusterDistance.value,
  }))

  const scenarioFilter = computed((): ScenarioFilter => ({
    startTime: startTime.value,
    endTime: endTime.value,
    selectedRouteTypes: selectedRouteTypes.value,
    selectedWeekdays: selectedWeekdays.value,
    selectedWeekdayMode: selectedWeekdayMode.value,
    selectedAgencies: selectedAgencies.value,
    frequencyUnder: frequencyUnder.value,
    frequencyOver: frequencyOver.value,
    stopVisitsUnder: stopVisitsUnder.value,
    stopVisitsOver: stopVisitsOver.value,
    selectedFareCategories: selectedFareCategories.value,
    fareMax: fareMax.value,
    fareMin: fareMin.value,
    clusterMaxTransferMinutes: clusterMaxTransferMinutes.value,
  }))

  const selectedDateRange = computed(() => getSelectedDateRange(scenarioConfig.value))

  // Flex display features (map + Reports tab). Instantiated here because it
  // depends on scenarioFilterResult; consumed by the map and report components.
  const { flexDisplayFeatures, flexFeaturesForReport } = useFlexDisplayFeatures({
    scenarioData,
    scenarioFilterResult,
    startTime,
    endTime,
    flexServicesEnabled,
    flexAdvanceNotice,
    flexAreaTypesSelected,
    flexRiderEligibility,
    flexColorBy,
    hideUnmarked,
  })

  // Unique census geography IDs for the current aggregate layer across all marked stops.
  // Shared base for both the filter summary count and the choropleth geometry fetch.
  const aggregateGeoIds = computed((): number[] => {
    if (!scenarioFilterResult.value) { return [] }
    const ids = new Set<number>()
    for (const stop of scenarioFilterResult.value.stops) {
      if (!stop.marked) { continue }
      for (const geo of stop.census_geographies || []) {
        if (geo.layer_name === aggregateLayer.value) {
          ids.add(geo.id)
        }
      }
    }
    return [...ids]
  })

  const aggregateGeoCount = computed((): number => aggregateGeoIds.value.length)

  const aggregateLayerLabel = computed((): string => {
    const labels = censusLayerLabels[aggregateLayer.value]
    if (!labels) {
      return aggregateGeoCount.value === 1 ? 'area' : 'areas'
    }
    return aggregateGeoCount.value === 1 ? labels.singular : labels.plural
  })

  /////////////////
  // Choropleth aggregation overlay
  /////////////////

  // Geographies the choropleth still needs a full outline for. In a clipped mode
  // that's only the ones the census phase returned no clipped outline for — a
  // geography the clip doesn't reach, or the window before those outlines have
  // streamed in. Empty when the overlay is off.
  const choroplethGeoIds = computed((): number[] => {
    if (!showAggAreas.value) { return [] }
    const mode = aggClipMode.value
    const geos = scenarioFilterResult.value?.censusGeographies
    if (!geos) { return [] }
    return [...geos.values()]
      .filter(g => !censusApportionGeometry(g, mode))
      .map(g => g.id)
  })

  // Fetch geometry for the choropleth geographies
  const {
    result: choroplethGeoResult,
  } = useQuery<{ census_datasets: CensusDataset[] }>(
    geographyLayerQuery,
    () => ({
      dataset_name: geoDatasetName.value,
      geography_ids: choroplethGeoIds.value,
      include_geographies: true,
    }),
    () => ({
      enabled: choroplethGeoIds.value.length > 0,
    })
  )

  // Compute aggregate stats per geography
  // The stop set the census clip is computed against, so buffer coverage tracks
  // the filter rather than the whole query area.
  const markedStopIds = computed((): number[] =>
    (scenarioFilterResult.value?.stops || []).filter(s => s.marked).map(s => s.id))

  // Every geography's aggregation row, before the clip filter below. The census
  // panel reads these, so a selection survives a switch to a clip that doesn't
  // reach the geography.
  const aggregateRows = computed(() => {
    if (!showAggAreas.value || !scenarioFilterResult.value) {
      return []
    }
    const markedStops = scenarioFilterResult.value.stops.filter(s => s.marked)
    return stopGeoAggregateCsv(
      markedStops,
      aggregateLayer.value,
      routesById(scenarioFilterResult.value.routes),
      scenarioFilterResult.value.censusGeographies,
      { onlyWithStops: onlyWithStops.value },
    )
  })

  const choroplethAggregateData = computed(() => {
    // A clipped mode measures nothing for a geography the clip doesn't reach, so
    // drop it rather than paint an empty polygon at zero. Filtered here so the
    // legend's breaks aren't skewed by a pile of zeroes either. Rows with no
    // census entry are stop-derived and unaffected.
    const mode = aggClipMode.value
    const geos = scenarioFilterResult.value?.censusGeographies
    return aggregateRows.value.filter((r) => {
      const geo = geos?.get(r.geoid)
      return !geo || censusApportionRatio(geo, mode) > 0
    })
  })

  const { stopBufferFeatures } = useStopBufferFeatures({ scenarioFilterResult, showStopBuffer, stopBufferRadius })

  const { choroplethClassification, choroplethFeatures } = useChoroplethClassification({
    choroplethAggregateData,
    censusGeographies: computed(() => scenarioFilterResult.value?.censusGeographies),
    choroplethGeoResult,
    selectedAggregationGeoid: deps.selectedAggregationGeoid,
    showAggAreas,
    aggClipMode,
    choroplethElement,
    shadeByDensity,
    unitSystem,
  })

  /////////////////
  // Run and refetches
  /////////////////

  // The scenario run lifecycle owns the loading/progress state, the streaming
  // fetch, and the shared receiver that the refetch composables reuse.
  const run = useScenarioRun({
    scenarioData,
    scenarioFilterResult,
    scenarioConfig,
    scenarioFilter,
    fetchMode: deps.fetchMode,
    pinScenarioInputs,
  })

  // The state each refetch shares with the run.
  const refetchDeps = {
    scenarioReceiver: run.scenarioReceiver,
    scenarioData,
    scenarioConfig,
    loadingProgress: run.loadingProgress,
    showLoadingModal: run.showLoadingModal,
    error: run.error,
    requestErrors: run.requestErrors,
    phasePlan: run.phasePlan,
    phaseFractions: run.phaseFractions,
    refetchInFlight: run.refetchInFlight,
    runInFlight: run.runInFlight,
    fetchMode: deps.fetchMode,
  }

  // Debounced standalone recomputes that stream into the same receiver without
  // re-running the whole scenario.
  useBufferRefetch(refetchDeps)

  // recompute clusters when the distance changes, reusing the same receiver.
  useClusterRefetch(refetchDeps)

  // reload each stop's census geography when the Aggregate-by layer changes —
  // the phase fetches one layer, so the previous one's entries no longer match.
  useStopCensusRefetch(refetchDeps)

  // recompute census values when the Aggregate-by layer or the stop buffer radius
  // changes, and on demand from the Map Display refresh, reusing the same receiver.
  const { refresh: refreshCensusClip } = useAggregateRefetch({ ...refetchDeps, markedStopIds })

  /////////////////
  // Filter tags
  /////////////////

  const filterTags = computed((): FilterTag[] => {
    const tags: FilterTag[] = []

    // route types
    const selectedRtypes = scenarioFilter.value.selectedRouteTypes
    if (selectedRtypes == null || selectedRtypes.length === 0 || selectedRtypes.length === routeTypeNames.size) {
      tags.push({ label: 'Route Type', value: 'All', active: false })
    } else {
      for (const rt of selectedRtypes) {
        const name = toTitleCase(routeTypeNames.get(rt) || '')
        if (name) {
          tags.push({ label: 'Route Type', value: name, active: true })
        }
      }
    }

    // date range
    const sd = startDate.value
    const ed = endDate.value
    const sameMonthYear = fmtDate(sd, 'MMM yyyy') === fmtDate(ed, 'MMM yyyy')
    if (sameMonthYear) {
      tags.push({ label: 'Dates', value: `${fmtDate(sd, 'dd')} – ${fmtDate(ed, 'dd MMM, yyyy')}`, active: true })
    } else {
      tags.push({ label: 'Dates', value: `${fmtDate(sd, 'dd MMM, yyyy')} – ${fmtDate(ed, 'dd MMM, yyyy')}`, active: true })
    }

    // days of week
    const days = scenarioFilter.value.selectedWeekdays
    const dowMode = scenarioFilter.value.selectedWeekdayMode
    if (days == null || days.length === 0) {
      tags.push({ label: 'Days of Week', value: 'All', active: false })
    } else {
      const modePrefix = dowMode === 'All' ? 'All of ' : 'Any of '
      tags.push({ label: 'Days of Week', value: modePrefix + days.map(val => toTitleCase(val)).join(', '), active: true })
    }

    // time of day
    const stime = fmtTime(scenarioFilter.value.startTime, 'p')
    const etime = fmtTime(scenarioFilter.value.endTime, 'p')
    if (stime && etime && stime !== etime) {
      tags.push({ label: 'Time of Day', value: `${stime} – ${etime}`, active: true })
    } else if (stime && !etime) {
      tags.push({ label: 'Time of Day', value: `After ${stime}`, active: true })
    } else if (etime && !stime) {
      tags.push({ label: 'Time of Day', value: `Before ${etime}`, active: true })
    } else {
      tags.push({ label: 'Time of Day', value: 'All', active: false })
    }

    // route frequency and stop visits thresholds. The "Over" filters are the
    // panel's ">" rows and the "Under" filters its "≦" rows, so Over is the
    // range minimum and Under the maximum.
    tags.push(rangeTag('Route frequency', scenarioFilter.value.frequencyOver, scenarioFilter.value.frequencyUnder, 'min', '≥'))
    tags.push(rangeTag('Stop visits', scenarioFilter.value.stopVisitsOver, scenarioFilter.value.stopVisitsUnder, 'visits', '>'))

    // fare categories
    const fareCategories = scenarioFilter.value.selectedFareCategories
    if (fareCategories == null) {
      tags.push({ label: 'Fares', value: 'All', active: false })
    } else {
      const value = fareCategories.length === 0 ? 'None' : fareCategories.map(c => fareCategoryLabels[c]).join(', ')
      tags.push({ label: 'Fares', value, active: true })
    }
    tags.push(fareAmountTag(scenarioFilter.value.fareMin, scenarioFilter.value.fareMax))

    // agencies
    const agencies = scenarioFilter.value.selectedAgencies
    if (agencies == null || agencies.length === 0) {
      tags.push({ label: 'Agencies', value: 'All', active: false })
    } else {
      for (const agency of agencies) {
        tags.push({ label: 'Agency', value: agency, active: true })
      }
    }

    return tags
  })

  // Drops the loaded data and its filtered result.
  function clear () {
    scenarioData.value = undefined
    scenarioFilterResult.value = undefined
  }

  return {
    scenarioData,
    scenarioFilterResult,
    scenarioConfig,
    selectedDateRange,
    // Query area
    savedGeographyAccess,
    savedGeographyLoading,
    savedSelectionRunnable,
    savedSelectionKind,
    accountHasSavedBoundaries,
    queryPolygon,
    queryGeographyIds,
    queryAreaName,
    queryGeographyMessages,
    savedGeographyLoads,
    rememberSavedGeography,
    censusGeographyLayerOptions,
    censusGeographiesSelected,
    // Map and report inputs
    flexDisplayFeatures,
    flexFeaturesForReport,
    aggregateGeoCount,
    aggregateLayerLabel,
    aggregateRows,
    stopBufferFeatures,
    choroplethClassification,
    choroplethFeatures,
    filterTags,
    // Run state, under useScenarioRun's names
    loadingProgress: run.loadingProgress,
    showLoadingModal: run.showLoadingModal,
    error: run.error,
    requestErrors: run.requestErrors,
    phasePlan: run.phasePlan,
    phaseFractions: run.phaseFractions,
    stopDepartureCount: run.stopDepartureCount,
    refetchInFlight: run.refetchInFlight,
    runInFlight: run.runInFlight,
    runQuery: run.runQuery,
    refreshCensusClip,
    clear,
  }
}

// Tag for a min/max threshold pair; inactive "All" when neither is set. The
// lower-bound operator is passed in because the two filters differ: routeMarked
// rejects a route only below the bound, so frequency admits equality (≥), while
// the stop-visits gate is strictly greater (>). Both bounds render both
// operators rather than an "N unit" range, since an equal pair is an exact
// match under ≥ but matches nothing under >.
function rangeTag (label: string, min: number | undefined, max: number | undefined, unit: string, minOp: '≥' | '>'): FilterTag {
  if (min != null && max != null) {
    return { label, value: `${minOp}${min}, ≤${max} ${unit}`, active: true }
  }
  if (min != null) {
    return { label, value: `${minOp}${min} ${unit}`, active: true }
  }
  if (max != null) {
    return { label, value: `≤${max} ${unit}`, active: true }
  }
  return { label, value: 'All', active: false }
}

// "$1.00 to $2.50", "At most $2.50", or "At least $1.00".
function fareAmountTag (min: number | undefined, max: number | undefined): FilterTag {
  const label = 'Fare amount'
  if (min != null && max != null) {
    return { label, value: `${formatFareAmount(min)} to ${formatFareAmount(max)}`, active: true }
  }
  if (max != null) {
    return { label, value: `At most ${formatFareAmount(max)}`, active: true }
  }
  if (min != null) {
    return { label, value: `At least ${formatFareAmount(min)}`, active: true }
  }
  return { label, value: 'All', active: false }
}

function toTitleCase (str: string): string {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  )
}
