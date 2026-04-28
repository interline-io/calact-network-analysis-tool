<template>
  <NuxtLayout name="default">
    <template #breadcrumbs />
    <template #footer />
    <template #menu-items>
      <ul class="menu-list">
        <li>
          <a :class="itemHelper('query')" title="Query" role="button" @click="setTab({ tab: 'query', sub: '' })">
            <cat-icon
              icon="magnify"
              class="is-fullwidth"
              size="large"
              variant="white"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('filter'), { 'is-disabled': !scenarioFilterResult }]"
            :title="scenarioFilterResult ? 'Filter' : 'Filter (Run a query first)'"
            role="button"
            @click="scenarioFilterResult && setTab({ tab: 'filter', sub: '' })"
          >
            <cat-icon
              icon="filter"
              class="is-fullwidth"
              size="large"
              :variant="scenarioFilterResult ? 'white' : 'dark'"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('map'), { 'is-disabled': !scenarioFilterResult }]"
            :title="scenarioFilterResult ? 'Map' : 'Map (Run a query first)'"
            role="button"
            @click="scenarioFilterResult && setTab({ tab: 'map', sub: '' })"
          >
            <cat-icon
              icon="map"
              class="is-fullwidth"
              size="large"
              :variant="scenarioFilterResult ? 'white' : 'dark'"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('report'), { 'is-disabled': !scenarioFilterResult }]"
            :title="scenarioFilterResult ? 'Report' : 'Report (Run a query first)'"
            role="button"
            @click="scenarioFilterResult && setTab({ tab: 'report', sub: '' })"
          >
            <cat-icon
              icon="file-chart"
              class="is-fullwidth"
              size="large"
              :variant="scenarioFilterResult ? 'white' : 'dark'"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('analysis')" title="Analysis" role="button" @click="setTab({ tab: 'analysis', sub: '' })">
            <cat-icon
              icon="chart-scatter-plot"
              class="is-fullwidth"
              size="large"
              variant="white"
            />
          </a>
        </li>
      </ul>
    </template>

    <template #main>
      <div style="position:relative">
        <div v-if="activeTab.tab === 'query'" class="cal-tab-content cal-tab-query">
          <cal-query
            :census-geography-layer-options="censusGeographyLayerOptions"
            :viewport-geographies="viewportGeographies"
            :viewport-geographies-loading="viewportGeoLoading"
            :viewport-geographies-limit="VIEWPORT_GEO_LIMIT"
            :map-extent-center="mapExtentCenter"
            :census-geographies-selected="censusGeographiesSelected"
            :scenario-loaded="!!scenarioData"
            @explore="runQuery"
            @load-example-data="loadExampleData"
            @switch-to-analysis-tab="setTab({ tab: 'analysis', sub: '' })"
            @reset-scenario="clearScenario"
            @fit-to-geographies="fitToGeographies"
            @clear-geographies="clearGeographies"
          />
        </div>

        <div
          v-if="activeTab.tab === 'filter'"
          :class="['cal-tab-content', 'cal-tab-filter', { 'has-subtab': activeTab.sub }]"
        >
          <cal-filter
            :scenario-filter-result="scenarioFilterResult"
            :agency-filter-items="agencyFilterItems"
            :census-geographies-selected="censusGeographiesSelected"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :aggregate-geo-count="aggregateGeoCount"
            :aggregate-layer-label="aggregateLayerLabel"
            :active-tab="activeTab.sub"
            @reset-filters="resetFilters"
            @show-query="activeTab = { tab: 'query', sub: '' }"
          />
        </div>

        <div v-if="activeTab.tab === 'report'" class="cal-tab-content cal-tab-report">
          <cal-report
            :census-geography-layer-options="censusGeographyLayerOptions"
            :scenario-filter-result="scenarioFilterResult"
            :export-features="exportFeatures"
            :filter-tags="filterTags"
            :flex-display-features="flexFeaturesForReport"
            @open-timetable="openRouteTimetable"
          />
        </div>

        <div v-if="activeTab.tab === 'analysis'" class="cal-tab-content cal-tab-analysis">
          <analysis-picker
            :scenario-data="scenarioData"
            :scenario-config="scenarioConfig"
            @cancel="setTab({ tab: 'query', sub: '' })"
          />
        </div>

        <!-- This is a component for displaying the map and legend -->
        <cal-map
          :census-geographies-selected="censusGeographiesSelected"
          :viewport-geographies="viewportGeographies"
          :scenario-filter-result="scenarioFilterResult"
          :display-edit-bbox-mode="displayEditBboxMode"
          :show-bbox="showBboxOnMap"
          :choropleth-features="choroplethFeatures"
          :choropleth-classification="choroplethClassification"
          :flex-display-features="flexDisplayFeatures"
          :loading-stage="loadingProgress?.currentStage"
          :panel-width="activeTabPanelWidth"
          :fit-overlay-key="fitOverlayKey"
          @set-map-extent="setMapExtent"
          @set-export-features="exportFeatures = $event"
          @toggle-geography="toggleGeography"
          @open-timetable="openRouteTimetable({ route: $event, initialTab: 'trips' })"
          @select-aggregation="onSelectAggregation"
          @view-census-details="openCensusDetails"
        >
          <template #sidebar-top>
            <cal-census-panel
              :row="selectedPanelData?.row ?? null"
              :layer-label="aggregateLayerLabel"
              :apportioned-derived="selectedPanelData?.apportionedDerived ?? null"
              :all-derived="allGeographiesDerived"
              :area-stats="selectedPanelData?.areaStats ?? null"
              @close="selectedAggregationGeoid = null"
              @view-details="openCensusDetails(selectedAggregationGeoid ?? undefined)"
            />
          </template>
        </cal-map>

        <div v-if="acsDatasetLabel" class="cal-acs-vintage">
          Showing data for {{ acsDatasetLabel }}
        </div>
      </div>

      <!-- Loading Progress Modal - positioned at the end for highest z-index -->
      <cat-modal
        v-model="showLoadingModal"
        title="Loading"
        :closable="false"
      >
        <cal-scenario-loading
          :progress="loadingProgress"
          :error="error"
          :stop-departure-count="stopDepartureCount"
          :scenario-data="scenarioData"
        />
      </cat-modal>

      <!-- Route Timetable debug modal -->
      <cat-modal
        v-model="showTimetable"
        title="Route Timetable"
        full-screen
      >
        <cal-route-timetable
          v-if="timetableRoute && scenarioFilterResult"
          :route="timetableRoute"
          :scenario-filter-result="scenarioFilterResult"
          :selected-date-range="selectedDateRange"
          :start-time="startTime"
          :end-time="endTime"
          :initial-tab="timetableInitialTab"
        />
      </cat-modal>

      <cat-modal
        v-model="showCensusDetails"
        title="Census Details"
        full-screen
      >
        <cal-census-details
          v-if="scenarioFilterResult"
          :scenario-filter-result="scenarioFilterResult"
          :layer-label="aggregateLayerLabel"
          :highlighted-geoid="highlightedCensusGeoid ?? undefined"
          @select-geography="onSelectGeographyFromDetails"
          @clear-filter="highlightedCensusGeoid = null"
        />
      </cat-modal>
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { computed, watch } from 'vue'
import { useQuery, useLazyQuery } from '@vue/apollo-composable'
import { useFlexAreaFormatting } from '~/composables/useFlexAreaFormatting'
import {
  getFlexAreaType,
  getFlexAdvanceNotice,
  getFlexAgencyName,
  geographyLayerQuery,
  geographyBboxQuery,
  stopGeoAggregateCsv,
} from '~~/src/tl'
import {
  type Bbox,
  type Point,
  type Feature,
  type AgencyFilterItem,
  createCategoryColorScale,
  flexColors,
  routeTypeNames,
  fmtDate,
  fmtTime,
  dateToSeconds,
  convertBbox,
  SCENARIO_DEFAULTS,
  censusLayerLabels,
  flexAdvanceNoticeTypes,
  flexAreaTypes,
  formatAcsDatasetLabel,
  summarizeBbox,
  deriveApportionedRow,
  type FilterTag,
  QUERY_PANEL_WIDTH,
  FILTER_COLLAPSED_WIDTH,
  FILTER_EXPANDED_WIDTH,
} from '~~/src/core'
import { navigateTo, useToastNotification, useRouter } from '#imports'
import type { FlexAdvanceNotice, FlexAreaType, FlexAreaFeature, CensusDataset, CensusGeography, Route } from '~~/src/tl'
import { ScenarioStreamReceiver, applyScenarioResultFilter, getSelectedDateRange, type ScenarioConfig, type ScenarioData, type ScenarioFilter, type ScenarioFilterResult, ScenarioDataReceiver, type ScenarioProgress } from '~~/src/scenario'

// Initialize composables
const { buildFlexAreaProperties } = useFlexAreaFormatting()
const {
  showAggAreas,
  aggregateLayer,
  onlyWithStops,
  hideUnmarked,
} = useScenarioUrlState()
const {
  bbox,
  cannedBbox,
  startDate,
  endDate,
  geographyIds,
  geomSource,
  geomLayer,
  geoDatasetName,
  includeFixedRoute,
  includeFlexAreas,
} = useScenarioInputs()
const {
  startTime,
  endTime,
  selectedRouteTypes,
  selectedAgencies,
  selectedWeekdays,
  selectedWeekdayMode,
  frequencyUnder,
  frequencyOver,
  flexServicesEnabled,
  flexAdvanceNotice,
  flexAreaTypesSelected,
  flexColorBy,
} = useScenarioFilters()

definePageMeta({
  layout: false
})

const route = useRoute()
const router = useRouter()

// Clears all loaded scenario and analysis result state
function clearScenario () {
  const { clearAllResults } = useAnalysisResults()
  scenarioData.value = undefined
  scenarioFilterResult.value = undefined
  exportFeatures.value = []
  querySubmitted.value = false
  clearAllResults()
}

// Route navigation guard to prevent accidentally leaving /tne with loaded scenario or analysis data
router.beforeEach((to, from) => {
  if (from.path !== '/tne' || to.path === '/tne') {
    return true
  }

  const { hasAnyResults } = useAnalysisResults()
  const hasScenarioData = !!scenarioData.value

  if (!hasScenarioData && !hasAnyResults.value) {
    return true
  }

  let message: string
  if (hasAnyResults.value) {
    message = 'You have analysis results displayed. Navigating away will clear your query and analysis results — you\'ll need to run them again. Do you want to continue?'
  } else {
    message = 'You have a loaded scenario. Navigating away will clear your query results — you\'ll need to run the query again to see them. Do you want to continue?'
  }

  const confirmed = confirm(message)
  if (!confirmed) {
    return false
  }

  clearScenario()
  return true
})

/////////////////
// Loading and error handling
/////////////////

// Track whether a query has been submitted — stops map extent from updating bbox
const querySubmitted = ref(false)

// Reset querySubmitted when the user picks a different canned bbox so the
// new bbox value takes effect rather than the stale explicit bbox.
watch(cannedBbox, () => { querySubmitted.value = false })

const error = ref(undefined as Error | string | undefined)

// Runs on explore event from query (when user clicks "Run Query")
const runQuery = async () => {
  querySubmitted.value = true
  showLoadingModal.value = true
  activeTab.value = { tab: 'map', sub: '' }
  try {
    await fetchScenario('')
  } catch (err: any) {
    error.value = err
  }
  if (!error.value) {
    useToastNotification().showToast('Browsing query data loaded successfully!')
    showLoadingModal.value = false
  }
  loadingProgress.value = undefined
}

// Scenario data ref - defined early so flex computed properties can reference it
// This is populated when fetchScenario runs
const scenarioData = ref<ScenarioData>()

// Flex areas filtering and styling (inline, similar to how fixed-route uses applyScenarioResultFilter)
// Raw data comes from scenario stream via scenarioData.flexAreas

// Agency filter items with metadata about service types
// Uses raw scenarioData (not filtered scenarioFilterResult) so ALL agencies appear
// in the filter list, even if their routes are currently filtered out
const agencyFilterItems = computed((): AgencyFilterItem[] => {
  const agencyMap = new Map<string, AgencyFilterItem>()

  // Collect from fixed-route data (raw, unfiltered)
  for (const route of scenarioData.value?.routes || []) {
    const name = route.agency?.agency_name
    if (!name) { continue }
    const item = agencyMap.get(name) || { name, hasFixedRoute: false, hasFlex: false }
    item.hasFixedRoute = true
    agencyMap.set(name, item)
  }

  // Collect from flex data (raw, unfiltered)
  for (const feature of scenarioData.value?.flexAreas || []) {
    for (const agency of feature.properties.agencies || []) {
      const name = agency.agency_name
      if (!name) { continue }
      const item = agencyMap.get(name) || { name, hasFixedRoute: false, hasFlex: false }
      item.hasFlex = true
      agencyMap.set(name, item)
    }
  }

  return Array.from(agencyMap.values()).sort((a, b) => a.name.localeCompare(b.name))
})

const flexAgencyNames = computed(() => {
  const names = new Set<string>()
  for (const feature of scenarioData.value?.flexAreas || []) {
    const name = getFlexAgencyName(feature)
    if (name) { names.add(name) }
  }
  return Array.from(names).sort()
})

const flexAgencyColorScale = computed(() => {
  return createCategoryColorScale(flexAgencyNames.value, flexColors.agency)
})

// Check if a flex area matches the current filters
// Returns true if it matches, false if it should be "downplayed"
const flexAreaMatchesFilters = (feature: FlexAreaFeature): boolean => {
  // Filter to only valid values to handle potential invalid URL query params
  // undefined means "not set" = all values match (no filter applied)
  const advanceNoticeFilter = flexAdvanceNotice.value?.filter(
    (v): v is FlexAdvanceNotice => flexAdvanceNoticeTypes.includes(v as FlexAdvanceNotice)
  )
  const areaTypesFilter = flexAreaTypesSelected.value?.filter(
    (v): v is FlexAreaType => flexAreaTypes.includes(v as FlexAreaType)
  )

  const featureAreaType = getFlexAreaType(feature)
  // If filter is set (not undefined) and doesn't include this type, filter it out
  if (areaTypesFilter !== undefined && !areaTypesFilter.includes(featureAreaType)) { return false }

  const featureAdvanceNotice = getFlexAdvanceNotice(feature)
  // If filter is set (not undefined) and doesn't include this notice type, filter it out
  if (advanceNoticeFilter !== undefined && !advanceNoticeFilter.includes(featureAdvanceNotice)) { return false }

  // Time-of-day filtering for flex areas
  const applyTimeFilter = startTime.value != null || endTime.value != null
  if (applyTimeFilter) {
    const userStartSeconds = dateToSeconds(startTime.value)
    const userEndSeconds = dateToSeconds(endTime.value)
    const flexStart = feature.properties.time_window_start
    const flexEnd = feature.properties.time_window_end

    // If flex area has time windows defined and user has set time filters, check for overlap
    if (flexStart !== undefined && flexEnd !== undefined
      && userStartSeconds !== undefined && userEndSeconds !== undefined) {
      const noOverlap = flexEnd < userStartSeconds || flexStart > userEndSeconds
      if (noOverlap) { return false }
    }
  }

  return true
}

// All flex areas with their "marked" status (matches filters)
// Base computed that always calculates marked status (independent of map toggle)
// Combines agency filtering from scenario-filter with advance notice, area type, and time filters
const flexAreasWithMarkedBase = computed(() => {
  return (scenarioFilterResult.value?.flexAreas || []).map(feature => ({
    feature,
    // Combine marked status from scenario-filter (agency) with local filters (advance notice, area type, time)
    marked: (feature.properties.marked !== false) && flexAreaMatchesFilters(feature)
  }))
})

// Flex areas for map display (respects flexServicesEnabled toggle)
const flexAreasWithMarked = computed(() => {
  if (!flexServicesEnabled.value) { return [] }
  return flexAreasWithMarkedBase.value
})

// Flex areas for Reports tab (always available if data exists, independent of map toggle)
const flexAreasWithMarkedForReport = computed(() => {
  return flexAreasWithMarkedBase.value
})

const flexDisplayFeatures = computed((): Feature[] => {
  if (!flexServicesEnabled.value) { return [] }

  const colorBy = flexColorBy.value

  return flexAreasWithMarked.value
    .filter(({ marked }) => !hideUnmarked.value || marked) // Hide unmarked if toggle is on
    .map(({ feature, marked }) => {
      // Determine color based on colorBy mode
      let color: string
      if (colorBy === 'Advance notice') {
        const advanceNotice = getFlexAdvanceNotice(feature)
        color = flexColors.advanceNotice[advanceNotice] || flexColors.default
      } else {
        const agencyName = getFlexAgencyName(feature)
        color = flexAgencyColorScale.value(agencyName)
      }

      // Style based on marked status
      // Marked: filled polygon with solid outline
      // Unmarked: no fill, dashed outline, reduced opacity
      const fillOpacity = marked ? 0.3 : 0
      const strokeOpacity = marked ? 0.8 : 0.4

      const properties: Record<string, any> = {
        ...buildFlexAreaProperties(feature, marked),
        // Custom styling for marked/unmarked
        'fill': color,
        'fill-opacity': fillOpacity,
        'stroke': color,
        'stroke-width': 2,
        'stroke-opacity': strokeOpacity,
      }

      // Only set stroke-dasharray for unmarked features (dashed outline)
      if (!marked) {
        properties['stroke-dasharray'] = true
      }

      return {
        type: 'Feature',
        id: feature.id,
        geometry: feature.geometry,
        properties
      } as Feature
    })
})

// Flex features for Reports tab (always available if data exists, independent of map toggle)
const flexFeaturesForReport = computed((): Feature[] => {
  return flexAreasWithMarkedForReport.value.map(({ feature, marked }) => {
    return {
      type: 'Feature',
      id: feature.id,
      geometry: feature.geometry,
      properties: buildFlexAreaProperties(feature, marked)
    } as Feature
  })
})

/////////////////
// Geography datasets
/////////////////

const {
  result: censusGeographyResult,
} = useQuery<{ census_datasets: CensusDataset[] }>(
  geographyLayerQuery,
  () => ({
    dataset_name: geoDatasetName.value,
    geography_ids: geographyIds.value,
    include_geographies: geographyIds.value.length > 0,
  })
)

const CENSUS_LAYER_DISPLAY_NAMES: Record<string, string> = {
  place: 'City / Place',
  county: 'County',
  state: 'State',
  tract: 'Census Tract',
  bg: 'Block Group',
  blockgroup: 'Block Group',
  tabblock20: 'Census Block (2020)',
  county_subdivision: 'County Subdivision',
  urban_area: 'Urban Area',
  uac20: 'Urban Area (2020)',
  cbsa: 'Core-Based Statistical Area (CBSA)',
  csa: 'Combined Statistical Area (CSA)',
  zip: 'ZIP Code (ZCTA)',
  zcta: 'ZIP Code (ZCTA)',
  zcta520: 'ZIP Code (ZCTA, 2020)',
  cd: 'Congressional District',
  cd119: 'Congressional District (119th)',
  congressional_district: 'Congressional District',
  sldu: 'State Legislative District (Upper)',
  sldl: 'State Legislative District (Lower)',
}

function formatCensusLayerLabel (_dsName: string, layerName: string): string {
  // Use human-readable name when known; otherwise strip "Layer: " prefix and title-case
  return CENSUS_LAYER_DISPLAY_NAMES[layerName]
    ?? layerName.replace(/^layer:\s*/i, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const censusGeographyLayerOptions = computed(() => {
  const geomDatasets = censusGeographyResult.value?.census_datasets || []
  const options = []
  for (const ds of geomDatasets || []) {
    for (const layer of ds.layers || []) {
      options.push({ value: layer.name, label: formatCensusLayerLabel(ds.name, layer.name) })
    }
  }
  return options
})

const censusGeographiesSelected = computed((): CensusGeography[] => {
  const ret: CensusGeography[] = []
  for (const ds of censusGeographyResult.value?.census_datasets || []) {
    for (const geo of ds.geographies || []) {
      ret.push(geo)
    }
  }
  return ret
})

const acsDatasetLabel = computed(() => formatAcsDatasetLabel(SCENARIO_DEFAULTS.tableDatasetName))

const selectedAggregationGeoid = ref<string | null>(null)
function onSelectAggregation (row: Record<string, any>) {
  const geoid = row?.geoid
  selectedAggregationGeoid.value = typeof geoid === 'string' ? geoid : null
}

// Right-side census panel inputs, all derived from the selected geoid.
// Null when no polygon is selected or the row hasn't streamed in yet.
const selectedPanelData = computed(() => {
  const geoid = selectedAggregationGeoid.value
  if (!geoid) { return null }
  const row = choroplethAggregateData.value.find(r => r.geoid === geoid)
  if (!row) { return null }
  const geo = scenarioFilterResult.value?.censusGeographies?.get(geoid)
  return {
    row,
    apportionedDerived: geo ? deriveApportionedRow(geo.values, geo.intersectionRatio) : null,
    areaStats: geo
      ? {
          geometryArea: geo.geometryArea,
          intersectionArea: geo.intersectionArea,
          intersectionRatio: geo.intersectionRatio,
        }
      : null,
  }
})

// Bbox-wide aggregate, fed to the panel's "Query Area Total" column.
// Independent of the selection so it doesn't recompute on every click.
const allGeographiesDerived = computed((): Record<string, number | null> | null => {
  const geos = scenarioFilterResult.value?.censusGeographies
  if (!geos || geos.size === 0) {
    return null
  }
  return summarizeBbox(geos.keys(), geos).derived
})

/////////////////////////
// Event passing
/////////////////////////

// Tab handling
const activeTab = ref({ tab: 'query', sub: '' })

// CSS binding for filter expanded width (used via v-bind in <style>)
const filterExpandedWidthPx = `${FILTER_EXPANDED_WIDTH}px`

// Active panel width for map padding — tells the map how much of its left side is obscured
const activeTabPanelWidth = computed(() => {
  switch (activeTab.value.tab) {
    case 'query': return QUERY_PANEL_WIDTH
    case 'filter': return activeTab.value.sub ? FILTER_EXPANDED_WIDTH : FILTER_COLLAPSED_WIDTH
    default: return 0 // 'map', 'report', 'analysis'
  }
})

// Advanced report query parameter support
const advancedReport = computed({
  get () {
    return route.query.advancedReport?.toString() || ''
  },
  set (v: string) {
    setQuery({ ...route.query, advancedReport: v || undefined })
  }
})

const { showBbox } = useUiState()

// showBboxOnMap controls the bbox outline — visible when the filter toggle is on or on the query tab
const showBboxOnMap = computed(() => showBbox.value || activeTab.value.tab === 'query')

// displayEditBboxMode controls drag handles — only on query tab before query submission
watch([activeTab, geomSource, querySubmitted], () => {
  displayEditBboxMode.value = activeTab.value.tab === 'query' && geomSource.value === 'bbox' && !querySubmitted.value
})

const displayEditBboxMode = ref(activeTab.value.tab === 'query' && (route.query.geomSource?.toString() || 'bbox') === 'bbox')

// Initialize active tab based on advancedReport query parameter
onMounted(() => {
  if (advancedReport.value) {
    activeTab.value = { tab: 'analysis', sub: '' }
  }
})

// Watch for changes in advancedReport to sync tab state
watch(advancedReport, (newValue) => {
  if (newValue) {
    activeTab.value = { tab: 'analysis', sub: '' }
  }
})

interface Tab {
  tab: string
  sub: string
}

function setTab (v: Tab) {
  if (activeTab.value.tab === v.tab) {
    activeTab.value = { tab: 'map', sub: '' }
    return
  }

  // Check if we're leaving the analysis tab and have results
  if (activeTab.value.tab === 'analysis') {
    const { hasAnyResults, clearAllResults } = useAnalysisResults()
    if (hasAnyResults.value) {
      const confirmed = confirm('You have analysis results displayed. Switching tabs will clear these results — you\'ll need to run the analysis again to see them. Do you want to continue?')
      if (!confirmed) {
        return
      }
      clearAllResults()
    }
  }

  activeTab.value = v

  // Clear advancedReport when switching away from analysis tab
  if (v.tab !== 'analysis' && advancedReport.value) {
    advancedReport.value = ''
  }
}

/////////////////////////////
// Other setters
/////////////////////////////

// We need to keep reference to the map extent
const mapExtent = ref<Bbox>()

const mapExtentCenter = computed((): Point | undefined => {
  const bbox = mapExtent.value
  if (bbox?.valid) {
    return {
      lon: (bbox.ne.lon + bbox.sw.lon) / 2,
      lat: (bbox.ne.lat + bbox.sw.lat) / 2
    }
  }
  return undefined
})

watch(geomSource, () => {
  if (geomSource.value === 'mapExtent' && mapExtent.value) {
    bbox.value = mapExtent.value
  }
})

async function setMapExtent (v: Bbox) {
  mapExtent.value = v
  // Only update bbox from map extent before a query has been submitted
  if (geomSource.value === 'mapExtent' && !querySubmitted.value) {
    bbox.value = mapExtent.value
  }
}

/////////////////////////
// Viewport geography selection
/////////////////////////

// Fetch census geographies visible in the current map viewport
// Active only when in adminBoundary mode and before query submission
const VIEWPORT_GEO_LIMIT = 1000
const viewportGeoVars = computed(() => {
  const extent = mapExtent.value
  if (!extent?.valid || geomSource.value !== 'adminBoundary' || querySubmitted.value) {
    return null
  }
  // Pad the bbox by 30% so geographies at the edges are included
  const lonPad = (extent.ne.lon - extent.sw.lon) * 0.15
  const latPad = (extent.ne.lat - extent.sw.lat) * 0.15
  const paddedExtent: Bbox = {
    valid: true,
    sw: { lon: extent.sw.lon - lonPad, lat: extent.sw.lat - latPad },
    ne: { lon: extent.ne.lon + lonPad, lat: extent.ne.lat + latPad },
  }
  return {
    dataset_name: geoDatasetName.value,
    layer: geomLayer.value,
    bbox: convertBbox(paddedExtent),
    limit: VIEWPORT_GEO_LIMIT,
  }
})

const {
  result: viewportGeoResult,
  loading: viewportGeoLoading,
  load: viewportGeoLoad,
  refetch: viewportGeoRefetch,
} = useLazyQuery<{ census_datasets: CensusDataset[] }>(
  geographyBboxQuery,
  () => viewportGeoVars.value ?? {},
  {
    debounce: 300,
    keepPreviousResult: true,
  }
)

// load() returns true only on first invocation; after that we need refetch()
let viewportGeoLoaded = false
watch(viewportGeoVars, (vars) => {
  if (vars) {
    if (!viewportGeoLoaded) {
      viewportGeoLoad(geographyBboxQuery)
      viewportGeoLoaded = true
    } else {
      viewportGeoRefetch()
    }
  }
})

// All geographies visible in the viewport
const viewportGeographies = computed((): CensusGeography[] => {
  if (geomSource.value !== 'adminBoundary' || querySubmitted.value) {
    return []
  }
  const ret: CensusGeography[] = []
  for (const ds of viewportGeoResult.value?.census_datasets || []) {
    for (const geo of ds.geographies || []) {
      ret.push(geo)
    }
  }
  return ret
})

// Toggle a geography's selection state (called when user clicks a geography on the map)
function toggleGeography (geographyId: number) {
  const ids = [...geographyIds.value]
  const idx = ids.indexOf(geographyId)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(geographyId)
  }
  geographyIds.value = ids
}

function clearGeographies () {
  geographyIds.value = []
}

// Fit map to selected geographies — only on explicit user request (button click)
const fitOverlayKey = ref(0)
function fitToGeographies () {
  fitOverlayKey.value++
}

////////////////////////////
// Scenario
////////////////////////////

// Route Timetable debug modal state.
type RouteTimetableTab = 'frequency' | 'trips' | 'stops'
const timetableRoute = ref<Route | undefined>(undefined)
const timetableInitialTab = ref<RouteTimetableTab>('frequency')
const showTimetable = computed({
  get: () => timetableRoute.value !== undefined,
  set: (v: boolean) => {
    if (!v) {
      timetableRoute.value = undefined
    }
  },
})
function openRouteTimetable (payload: { route: Route, initialTab: RouteTimetableTab }) {
  timetableInitialTab.value = payload.initialTab
  timetableRoute.value = payload.route
}

const showCensusDetails = ref(false)
const highlightedCensusGeoid = ref<string | null>(null)
function openCensusDetails (geoid?: string) {
  highlightedCensusGeoid.value = geoid ?? null
  showCensusDetails.value = true
}
// Clear the geoid filter whenever the modal closes so the next open from
// the legend starts unfiltered.
watch(showCensusDetails, (open) => {
  if (!open) { highlightedCensusGeoid.value = null }
})

// Force the overlay on so the selection actually renders on the map.
function onSelectGeographyFromDetails (geoid: string) {
  showCensusDetails.value = false
  showAggAreas.value = true
  selectedAggregationGeoid.value = geoid
}
const selectedDateRange = computed(() => getSelectedDateRange(scenarioConfig.value))

// Computed properties for config and filter to avoid duplication
const scenarioConfig = computed((): ScenarioConfig => ({
  geoDatasetName: geoDatasetName.value,
  tableDatasetName: SCENARIO_DEFAULTS.tableDatasetName,
  aggregateLayer: aggregateLayer.value,
  reportName: 'Transit Network Explorer',
  bbox: bbox.value,
  startDate: startDate.value,
  endDate: endDate.value,
  geographyIds: geographyIds.value,
  // Data loading toggles from Query tab > Advanced Settings
  includeFixedRoute: includeFixedRoute.value,
  includeFlexAreas: includeFlexAreas.value,
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
}))

// Internal state for streaming scenario data
// Note: scenarioData is defined earlier in the file (before useFlexAreas)
const scenarioFilterResult = ref<ScenarioFilterResult | undefined>(undefined)
const exportFeatures = shallowRef<Feature[]>([])

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

// All census geographies in the query area, used to fetch geometry for the
// choropleth. Empty when the overlay is off.
const choroplethGeoIds = computed((): number[] => {
  if (!showAggAreas.value) { return [] }
  const geos = scenarioFilterResult.value?.censusGeographies
  if (!geos) { return [] }
  return [...geos.values()].map(g => g.id)
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
const choroplethAggregateData = computed(() => {
  if (!showAggAreas.value || !scenarioFilterResult.value) {
    return []
  }
  const markedStops = scenarioFilterResult.value.stops.filter(s => s.marked)
  return stopGeoAggregateCsv(
    markedStops,
    aggregateLayer.value,
    scenarioFilterResult.value.censusGeographies,
    { onlyWithStops: onlyWithStops.value },
  )
})

const { choroplethClassification, choroplethFeatures } = useChoroplethClassification({
  choroplethAggregateData,
  censusGeographies: computed(() => scenarioFilterResult.value?.censusGeographies),
  choroplethGeoResult,
  selectedAggregationGeoid,
})

// Loading progress tracking for modal
const loadingProgress = ref<ScenarioProgress>()
const stopDepartureCount = ref<number>(0)
const showLoadingModal = ref(false)

const loadExampleData = async (exampleName: string) => {
  console.log('loading example data:', exampleName)
  activeTab.value = { tab: 'map', sub: '' }
  fetchScenario(exampleName)
}

// Scenario fetching logic
const fetchScenario = async (loadExample: string) => {
  // console.log('fetchScenario:', loadExample)
  const config = scenarioConfig.value
  if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    return // Need either bbox or geography IDs, unless loading example
  }
  loadingProgress.value = undefined
  stopDepartureCount.value = 0

  // Create receiver to accumulate scenario data
  const receiver = new ScenarioDataReceiver({
    onProgress: (progress: ScenarioProgress) => {
      // Update progress for modal
      loadingProgress.value = progress
      stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0

      // Apply filters to partial data and emit (without schedule-dependent features)
      // Skip if no route/stop/flex data in this progress update
      const hasRoutes = (progress.partialData?.routes.length || 0) > 0
      const hasStops = (progress.partialData?.stops.length || 0) > 0
      const hasFlexAreas = (progress.partialData?.flexAreas.length || 0) > 0
      if (!hasRoutes && !hasStops && !hasFlexAreas) {
        return
      }
      scenarioData.value = receiver.getCurrentData()
    },
    onComplete: () => {
      // Get final accumulated data and apply filters
      loadingProgress.value = undefined
      scenarioData.value = receiver.getCurrentData()
    },
    onError: (err: any) => {
      error.value = err
    }
  })

  let response: Response

  if (loadExample) {
    // Load example data from public JSON file
    response = await fetch(`/examples/${loadExample}.json`)
  } else {
    // Make request to streaming scenario endpoint
    response = await fetch('/api/scenario', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    })
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('No response body received')
  }

  // Process the streaming response
  const streamer = new ScenarioStreamReceiver()
  const { success } = await streamer.processStream(response.body, receiver)
  if (!success) {
    error.value = new Error('Stream ended unexpectedly. The server may have run out of memory. Try a smaller region.')
  }
}

// Apply filters and emit results when data or filters change
watch(() => [
  scenarioData.value,
  scenarioFilter.value,
], () => {
  if (!scenarioData.value) {
    return
  }
  scenarioFilterResult.value = applyScenarioResultFilter(scenarioData.value, scenarioConfig.value, scenarioFilter.value)
})

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

  // frequencies
  const minFreq = scenarioFilter.value.frequencyOver
  const maxFreq = scenarioFilter.value.frequencyUnder
  if (minFreq != null && maxFreq != null && minFreq !== maxFreq) {
    tags.push({ label: 'Frequencies', value: `${minFreq}–${maxFreq} min`, active: true })
  } else if (minFreq != null && maxFreq != null && minFreq === maxFreq) {
    tags.push({ label: 'Frequencies', value: `${minFreq} min`, active: true })
  } else if (minFreq != null) {
    tags.push({ label: 'Frequencies', value: `≥${minFreq} min`, active: true })
  } else if (maxFreq != null) {
    tags.push({ label: 'Frequencies', value: `<${maxFreq} min`, active: true })
  } else {
    tags.push({ label: 'Frequencies', value: 'All', active: false })
  }

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

//////////////////////
// Helpers
//////////////////////

// Handle query parameters
async function setQuery (params: Record<string, any>) {
  await navigateTo({ replace: true, query: removeEmpty({ ...route.query, ...params }) })
}

async function resetFilters () {
  const p = removeEmpty({
    ...route.query,
    selectedAgencies: undefined,
    startTime: undefined,
    endTime: undefined,
    selectedWeekdays: undefined,
    selectedWeekdayMode: undefined,
    selectedRouteTypes: undefined,
    frequencyUnder: undefined,
    frequencyOver: undefined,
    calculateFrequencyMode: undefined,
    maxFareEnabled: undefined,
    maxFare: undefined,
    minFareEnabled: undefined,
    minFare: undefined,

    unitSystem: undefined,
    hideUnmarked: undefined,
    baseMap: undefined,
    fixedRouteEnabled: undefined,
    flexServicesEnabled: undefined,
    flexAdvanceNotice: undefined,
    flexAreaTypesSelected: undefined,
    flexColorBy: undefined,
  })
  await navigateTo({ replace: true, query: p })
}

function removeEmpty (v: Record<string, any>): Record<string, any> {
  const r: Record<string, any> = {}
  for (const k in v) {
    if (v[k] !== null && v[k] !== undefined) {
      r[k] = v[k]
    }
  }
  return r
}

function itemHelper (p: string): string {
  if (activeTab.value.tab === p) {
    return 'is-active'
  }
  return 'is-secondary'
}

function toTitleCase (str: string): string {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  )
}
</script>

<style scoped lang="scss">
// Base tab content styling - shared by all tabs
.cal-tab-content {
  position: absolute;
  top: 0;
  left: 0;
  height: 100vh;
  z-index: 1000;
  background: white;
}

// Individual tab width classes

.cal-tab-filter {

  &.has-subtab {
    width: v-bind(filterExpandedWidthPx);
    min-width: v-bind(filterExpandedWidthPx);
  }
}

.cal-tab-report {
  width: 100vw; // Report tab - full width, no map
}

.cal-tab-analysis {
  width: 100vw; // Analysis tab - full width, no map
}

// Disabled tab styling
.is-disabled {
  opacity: 0.5;
  cursor: not-allowed !important;

  // Allow hover events for tooltips but prevent clicks
  pointer-events: auto;

  // Prevent clicks by making the click handler return early
  &:active {
    transform: none !important;
  }

  .o-icon {
    color: #999 !important;
  }
}

.cal-acs-vintage {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 9;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--bulma-border);
  border-radius: 4px;
  font-size: 12px;
  color: var(--bulma-text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}
</style>
