<template>
  <NuxtLayout name="default">
    <template #breadcrumbs />
    <template #footer />
    <template #menu-items>
      <ul class="menu-list">
        <li v-for="item of menuRailItems" :key="item.tab">
          <button
            type="button"
            class="cal-icon-button"
            :class="[itemHelper(item.tab), { 'is-disabled': item.requiresScenario && !scenarioFilterResult }]"
            :title="item.requiresScenario && !scenarioFilterResult ? `${item.label} (Run a query first)` : item.label"
            :aria-label="item.requiresScenario && !scenarioFilterResult ? `${item.label} (Run a query first)` : item.label"
            :aria-disabled="(item.requiresScenario && !scenarioFilterResult) || undefined"
            @click="(!item.requiresScenario || scenarioFilterResult) && setTab({ tab: item.tab, sub: '' })"
          >
            <cat-icon
              :icon="item.icon"
              class="is-fullwidth"
              size="large"
              :variant="!item.requiresScenario || scenarioFilterResult ? 'white' : 'dark'"
            />
          </button>
        </li>
      </ul>
    </template>

    <template #main>
      <div style="position:relative">
        <div v-if="activeTab.tab === 'query'" class="cal-tab-content cal-tab-query">
          <cal-query
            :scenario-params="scenarioParams"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :viewport-geographies="viewportGeographies"
            :viewport-geographies-loading="viewportGeoLoading"
            :viewport-geographies-limit="VIEWPORT_GEO_LIMIT"
            :map-extent-center="mapExtentCenter"
            :census-geographies-selected="censusGeographiesSelected"
            :scenario-loaded="!!scenarioData"
            :query-polygon="queryPolygon"
            :saved-geography-access="savedGeographyAccess"
            :saved-geography-loading="savedGeographyLoading"
            :saved-selection-runnable="savedSelectionRunnable"
            :saved-selection-kind="savedSelectionKind"
            :account-has-saved-boundaries="accountHasSavedBoundaries"
            :saved-geography-messages="queryGeographyMessages"
            @explore="runQuery"
            @switch-to-analysis-tab="setTab({ tab: 'analysis', sub: '' })"
            @reset-scenario="resetScenario"
            @fit-to-geographies="fitToGeographies"
            @clear-geographies="clearGeographies"
            @upload-saved="rememberSavedGeography($event.id, $event.name, $event.polygon)"
          />
        </div>

        <div
          v-if="activeTab.tab === 'filter'"
          :class="['cal-tab-content', 'cal-tab-filter', { 'has-subtab': activeTab.sub }]"
        >
          <cal-filter
            :scenario-params="scenarioParams"
            :scenario-filter-result="scenarioFilterResult"
            :agency-filter-items="agencyFilterItems"
            :census-geographies-selected="censusGeographiesSelected"
            :query-area-name="queryAreaName"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :aggregate-geo-count="aggregateGeoCount"
            :aggregate-layer-label="aggregateLayerLabel"
            :active-tab="activeTab.sub"
            @reset-filters="resetFilters"
            @show-query="activeTab = { tab: 'query', sub: '' }"
            @refresh-census="refreshCensusClip"
          />
        </div>

        <div v-if="activeTab.tab === 'report'" class="cal-tab-content cal-tab-report">
          <cal-report
            v-model:tab="reportTab"
            :scenario-params="scenarioParams"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :scenario-filter-result="scenarioFilterResult"
            :export-features="exportFeatures"
            :filter-tags="filterTags"
            :flex-display-features="flexFeaturesForReport"
            @open-buffer-details="openBufferDetails"
            @open-trips="openReportTrips"
            @open-transfers="openTransfers"
          >
            <template #transfers>
              <cal-transfer-report
                v-model:subject="transferSubject"
                v-model:view="transferView"
                v-model:section="transferSection"
                v-model:date="transferDate"
                v-model:start-time="startTime"
                v-model:end-time="endTime"
                v-model:settings="transfers.settings"
                :title="transfers.title"
                :subject-options="transfers.subjectOptions"
                :custom-from="transfers.customFrom"
                :share-url="transferShareUrl"
                :stops="transfers.stopIds"
                :map-stops="transferSection === 'stops' ? transfers.mapStops : []"
                :map-routes="transferSection === 'stops' ? transfers.mapRoutes : []"
                :extent="transferExtent"
                :clustering-off="clusterDistance === 0"
                :breakpoints="transfers.breakpoints"
                :midnight-cut="transfers.midnightCut"
                :route-choices="transfers.routeChoices"
                :compass="transfers.compass"
                :rose="transferView === 'compass' ? transfers.rose : EMPTY_ROSE"
                :unknown-pairs="transfers.unknownPairs"
                :summary-grid="transferView === 'summary' ? transfers.summaryGrid : []"
                :csv-rows="transfers.csvRows"
                :overview="transfers.overview"
                :individual-dates="transfers.individualDates"
                :individual-date="transfers.individualDate"
                :individual-grid="transferView === 'individual' ? transfers.individualGrid : []"
                :individual-points="transferView === 'individual' ? transfers.individualPoints : []"
                :missing-details="transfers.missingDetails"
                :details-loading="transfers.detailsLoading"
                :details-error="transfers.detailsError"
                @retry="transfers.retry()"
                @open-trips="openReportTrips({ kind: 'route', routeId: $event })"
                @update:stops="transfers.setStopIds($event)"
                @reset-stops="transferStopEdits = { added: [], removed: [] }"
                @enable-clusters="enableClustersForTransfers"
              />
            </template>
          </cal-report>
        </div>

        <div v-if="activeTab.tab === 'analysis'" class="cal-tab-content cal-tab-analysis">
          <!-- A report's run records its inputs, as a browse run does, so the
               report's link reruns it with the same area and dates. -->
          <analysis-picker
            v-model:advanced-report="advancedReport"
            :scenario-data="scenarioData"
            :scenario-config="scenarioConfig"
            :fetch-mode="fetchMode"
            @cancel="setTab({ tab: 'query', sub: '' })"
            @run="pinScenarioInputs"
          />
        </div>

        <!-- This is a component for displaying the map and legend -->
        <cal-map
          :scenario-params="scenarioParams"
          :census-geographies-selected="censusGeographiesSelected"
          :query-polygon="queryPolygon"
          :viewport-geographies="viewportGeographies"
          :scenario-filter-result="scenarioFilterResult"
          :display-edit-bbox-mode="displayEditBboxMode"
          :show-bbox="showBboxOnMap"
          :choropleth-features="choroplethFeatures"
          :stop-buffer-features="stopBufferFeatures"
          :choropleth-classification="choroplethClassification"
          :flex-display-features="flexDisplayFeatures"
          :loading-stage="loadingProgress?.currentStage"
          :panel-width="activeTabPanelWidth"
          :fit-overlay-key="fitOverlayKey"
          :sidebar-panel-open="!!tripPanelSubject || !!selectedPanelData?.row"
          :clear-selection-key="mapSelectionClearKey"
          @set-map-extent="setMapExtent"
          @set-export-features="exportFeatures = $event"
          @toggle-geography="toggleGeography"
          @select-aggregation="onSelectAggregation"
          @view-census-details="openCensusDetails"
          @show-trips="openTripPanel"
          @open-transfers="openTransfers"
          @selection-cleared="closeTripPanel"
        >
          <template #sidebar-top>
            <!-- Keyed by subject, so each feature opens fresh. -->
            <cal-trip-panel
              v-if="tripPanelSubject && tripPanelTrips"
              :key="JSON.stringify(tripPanelOpenedSubject)"
              :subject="tripPanelSubject"
              :title="tripPanelTitle"
              :trips="tripPanelTrips"
              :rows="tripPanelRows"
              :routes="tripPanelRoutes"
              :details-loading="tripPanelDetailsLoading"
              :details-error="tripPanelDetailsError"
              @close="onTripPanelClose"
              @load-details="loadTripPanelDetails('preview')"
              @expand-trips="openTripTable"
              @open-transfers="tripPanelOpenedSubject && openTransfers(tripPanelOpenedSubject)"
            />
            <cal-census-panel
              v-model:choropleth-element="choroplethElement"
              :row="selectedPanelData?.row ?? null"
              :layer-label="aggregateLayerLabel"
              :geography="selectedPanelData?.geography ?? null"
              :analysis-area="analysisAreaPanelData"
              :unit-system="unitSystem"
              :stop-buffer-radius="stopBufferRadius"
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
        :closable="!!error || requestErrors.length > 0"
      >
        <cal-scenario-loading
          :progress="loadingProgress"
          :error="error"
          :request-errors="requestErrors"
          :stop-departure-count="stopDepartureCount"
          :scenario-data="scenarioData"
          :phase-plan="scenarioPhasePlan"
          :phase-fractions="scenarioPhaseFractions"
        />
      </cat-modal>

      <!-- Every trip behind the trip panel, or behind a Reports row, at full
           size; for a route, with how its report numbers are worked out -->
      <cat-modal
        v-model="showTripTable"
        :title="tripTableTitle"
        full-screen
      >
        <cal-trip-details
          v-if="tripTable.resolvedSubject && tripTable.trips"
          v-model:tab="tripTableTab"
          v-model:include-excluded="tripTableIncludeExcluded"
          :subject-kind="tripTable.resolvedSubject.kind"
          :rows="tripTable.rows"
          :multi-day="tripTable.multiDay"
          :title="tripTable.title"
          :details-loading="tripTable.detailsLoading"
          :details-error="tripTable.detailsError"
          :route="tripTableRoute"
          :scenario-filter-result="scenarioFilterResult"
          :selected-date-range="selectedDateRange"
          :selected-weekdays="selectedWeekdays"
          :selected-weekday-mode="selectedWeekdayMode"
          :start-time="startTime"
          :end-time="endTime"
          @retry="tripTable.loadDetails('all')"
        />
      </cat-modal>

      <cat-modal
        v-model="showCensusDetails"
        title="Census Details"
        full-screen
      >
        <cal-census-details
          v-if="scenarioFilterResult"
          :entries="censusDetailsEntries"
          :layer-label="aggregateLayerLabel"
          :highlighted-geoid="highlightedCensusGeoid ?? undefined"
          @select-geography="onSelectGeographyFromDetails"
          @clear-filter="highlightedCensusGeoid = null"
        />
      </cat-modal>

      <cat-modal
        v-model="showBufferDetails"
        title="Stop Statistical Radius — Derivation"
        full-screen
      >
        <cal-census-details
          v-if="bufferDetailsPayload"
          :key="bufferDetailsPayload.entityId"
          :entries="bufferEntries"
          :header-props="bufferHeaderProps"
          :apportionment-summary="bufferApportionment"
          :filename-prefix="bufferFilenamePrefix"
          show-map
          :map-loading="bufferGeometryLoading"
          :map-error="bufferGeometryError"
          @load-geometry="loadBufferGeometry"
        />
      </cat-modal>
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, reactive, ref, shallowRef, watch } from 'vue'
import { useLazyQuery } from '@vue/apollo-composable'
import { useBufferDetails } from '~/composables/useBufferDetails'
import { createTripDetailsStore, useTripPanel } from '~/composables/useTripPanel'
import type { TripDetailsTab } from '~/components/cal/trip-details.vue'
import type { TransferReportSection, TransferReportView } from '~/components/cal/transfer/report.vue'
import type { ReportTab } from '~/components/cal/report.vue'
import { transferSubjectFromKey, transferSubjectKey, useSubjectTransfers, type TransferStopEdits } from '~/composables/useSubjectTransfers'
import { useFetchMode } from '~/composables/useFetchMode'
import { useUrlQuery } from '~/composables/useUrlQuery'
import { createScenarioParams } from '~/composables/scenarioParams'
import { useScenario } from '~/composables/useScenario'
import { geographyBboxQuery } from '~~/src/tl'
import type {
  CensusDataset,
  CensusGeography,
} from '~~/src/tl'
import {
  type Bbox,
  type Point,
  type Feature,
  type AgencyFilterItem,
  convertBbox,
  SCENARIO_DEFAULTS,
  formatAcsDatasetLabel,
  censusPanelAnalysisArea,
  censusPanelGeography,
  censusGeographyMapToEntries,
  type CensusGeographyEntry,
  QUERY_PANEL_WIDTH,
  FILTER_COLLAPSED_WIDTH,
  FILTER_EXPANDED_WIDTH,
  STOP_CLUSTER_DEFAULT_DISTANCE,
} from '~~/src/core'
import { useRouter } from '#imports'
import { type TransferRose, type TripSubject, decodeTransferSettings, encodeTransferSettings } from '~~/src/scenario'

// The URL's query, and the scenario parameters it holds. Components and
// composables below the page take the parameters they use from here.
const urlQuery = useUrlQuery()
const { query, setQuery } = urlQuery
const scenarioParams = createScenarioParams(urlQuery)
const {
  showAggAreas,
  aggClipMode,
  choroplethElement,
  showBbox,
  unitSystem,
} = scenarioParams.display
const {
  bbox,
  cannedBbox,
  geographyIds,
  geomSource,
  geomLayer,
  geoDatasetName,
  stopBufferRadius,
  clusterDistance,
  pinScenarioInputs,
} = scenarioParams.inputs
const {
  startTime,
  endTime,
  selectedWeekdays,
  selectedWeekdayMode,
} = scenarioParams.filters

// Whether runs fetch through the BFF or straight from the browser.
const fetchMode = useFetchMode()

// The aggregation area selected on the map, which the census panel describes.
const selectedAggregationGeoid = ref<string | null>(null)

// The scenario the parameters describe: its query area, its run, and what the
// map and reports draw from its results.
const {
  scenarioData,
  scenarioFilterResult,
  scenarioConfig,
  selectedDateRange,
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
  flexDisplayFeatures,
  flexFeaturesForReport,
  aggregateGeoCount,
  aggregateLayerLabel,
  aggregateRows,
  stopBufferFeatures,
  choroplethClassification,
  choroplethFeatures,
  filterTags,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  stopDepartureCount,
  refetchInFlight,
  runInFlight,
  runQuery: runScenarioQuery,
  refreshCensusClip,
  clear: clearScenarioData,
} = useScenario({ scenarioParams, fetchMode, selectedAggregationGeoid })

definePageMeta({
  layout: false
})

const router = useRouter()

// Clears all loaded scenario and analysis result state
function clearScenario () {
  const { clearAllResults } = useAnalysisResults()
  clearScenarioData()
  exportFeatures.value = []
  querySubmitted.value = false
  closeTripPanel()
  showTripTable.value = false
  // Shared with the trip table, so this forgets both views' details.
  clearTripPanelDetails()
  clearAllResults()
}

// Resets the query and the Transfer Analyst for a new query. Kept apart from
// clearScenario, which the leave guard also calls: a URL write there would
// cancel the navigation the guard just allowed.
function resetScenario () {
  clearScenario()
  setQuery({ transferAt: undefined, transferStops: undefined, transferDate: undefined })
  transfers.settings = decodeTransferSettings(undefined)
  transferView.value = 'summary'
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

// Runs on explore event from query (when user clicks "Run Query"). The
// modal/toast lifecycle is the shared one in useScenarioStream.
const runQuery = async () => {
  querySubmitted.value = true
  activeTab.value = { tab: 'map', sub: '' }
  await runScenarioQuery('Browsing query data loaded successfully!')
}

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

const acsDatasetLabel = computed(() => formatAcsDatasetLabel(SCENARIO_DEFAULTS.tableDatasetName))

function onSelectAggregation (row: Record<string, any>) {
  const geoid = row?.geoid
  selectedAggregationGeoid.value = typeof geoid === 'string' ? geoid : null
}

// Right-side census panel inputs, all derived from the selected geoid.
// Null when no polygon is selected or the row hasn't streamed in yet.
const selectedPanelData = computed(() => {
  const geoid = selectedAggregationGeoid.value
  if (!geoid) { return null }
  const row = aggregateRows.value.find(r => r.geoid === geoid)
  if (!row) { return null }
  const geo = scenarioFilterResult.value?.censusGeographies?.get(geoid)
  return { row, geography: geo ? censusPanelGeography(geo) : null }
})

// The panel's Analysis area tab, summed only while the panel is open: a
// statewide run makes the sums slow enough to feel on every filter change.
// Keyed on a boolean, so clicking between geographies doesn't redo them.
const censusPanelOpen = computed(() => selectedPanelData.value !== null)
const analysisAreaPanelData = computed(() => {
  const geos = scenarioFilterResult.value?.censusGeographies
  if (!censusPanelOpen.value || !geos || geos.size === 0) {
    return null
  }
  return censusPanelAnalysisArea(geos)
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
    return query.value.advancedReport?.toString() || ''
  },
  set (v: string) {
    setQuery({ advancedReport: v || undefined })
  }
})

// showBboxOnMap controls the bbox outline — visible when the filter toggle is on or on the query tab
const showBboxOnMap = computed(() => showBbox.value || activeTab.value.tab === 'query')

// displayEditBboxMode controls drag handles — only on query tab before query submission
watch([activeTab, geomSource, querySubmitted], () => {
  displayEditBboxMode.value = activeTab.value.tab === 'query' && geomSource.value === 'bbox' && !querySubmitted.value
})

const displayEditBboxMode = ref(activeTab.value.tab === 'query' && (query.value.geomSource?.toString() || 'bbox') === 'bbox')

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

// A map-extent link's bbox is the area it was run on. The map fits to it on
// load, and that fit's padded viewport, like any resize before the user moves
// the map, depends on the window and mustn't replace it. Once the user moves
// the map, or switches to map-extent mode, the visible extent is the area.
let holdLinkedExtent = geomSource.value === 'mapExtent' && !!query.value.bbox

watch(geomSource, () => {
  holdLinkedExtent = false
  if (geomSource.value === 'mapExtent' && mapExtent.value) {
    bbox.value = mapExtent.value
  }
})

async function setMapExtent (v: Bbox, userInitiated: boolean) {
  mapExtent.value = v
  if (userInitiated) {
    holdLinkedExtent = false
  }
  // Only update bbox from map extent before a query has been submitted
  if (geomSource.value === 'mapExtent' && !querySubmitted.value && !holdLinkedExtent) {
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

// Fit map to selected geographies — only on explicit user request: the "Show
// on map" button, or picking a geography from the search.
const fitOverlayKey = ref(0)
const geographyFitPending = ref(false)
function fitToGeographies () {
  geographyFitPending.value = true
}

// A newly picked geography's geometry arrives after geographyIds changes, so
// a fit request waits until censusGeographiesSelected matches the selection.
// An uploaded or saved polygon is ready once it's there.
const selectedGeographiesLoaded = computed(() => {
  if (queryPolygon.value) {
    return true
  }
  const loaded = new Set(censusGeographiesSelected.value.map(g => g.id))
  return loaded.size === queryGeographyIds.value.length && queryGeographyIds.value.every(id => loaded.has(id))
})
// Loading a saved geography, or a changed upload, shows it, as picking a
// boundary from the search does
watch([savedGeographyLoads, queryPolygon], ([loads, polygon], [prevLoads, prevPolygon]) => {
  if (loads !== prevLoads || (polygon && polygon !== prevPolygon)) {
    fitToGeographies()
  }
})
watch([geographyFitPending, selectedGeographiesLoaded], ([pending, loaded]) => {
  if (pending && loaded) {
    geographyFitPending.value = false
    fitOverlayKey.value++
  }
})

////////////////////////////
// Scenario
////////////////////////////

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

// Names come from stops.census_geographies — the only source today.
const censusDetailsEntries = computed<CensusGeographyEntry[]>(() => {
  const result = scenarioFilterResult.value
  if (!result?.censusGeographies) {
    return []
  }
  const nameMap = new Map<string, string>()
  for (const stop of result.stops || []) {
    for (const g of stop.census_geographies || []) {
      if (g.name && !nameMap.has(g.geoid)) {
        nameMap.set(g.geoid, g.name)
      }
    }
  }
  return censusGeographyMapToEntries(result.censusGeographies, aggClipMode.value, geoid => nameMap.get(geoid))
})

const {
  show: showBufferDetails,
  payload: bufferDetailsPayload,
  open: openBufferDetails,
  entries: bufferEntries,
  headerProps: bufferHeaderProps,
  apportionment: bufferApportionment,
  filenamePrefix: bufferFilenamePrefix,
  geometryLoading: bufferGeometryLoading,
  geometryError: bufferGeometryError,
  loadGeometry: loadBufferGeometry,
} = useBufferDetails()

// Force the overlay on so the selection actually renders on the map, leaving
// an already-chosen clip alone.
function onSelectGeographyFromDetails (geoid: string) {
  showCensusDetails.value = false
  showAggAreas.value = true
  selectedAggregationGeoid.value = geoid
}

// The map's marked features, which the Reports tab exports.
const exportFeatures = shallowRef<Feature[]>([])

// Fetched trip details, shared by the trip panel and the full trip table so a
// trip is fetched once whichever view asks first.
const tripDetailsStore = createTripDetailsStore()

// Trip information panel (#476), opened from a stop, route, or cluster popup.
const {
  subject: tripPanelOpenedSubject,
  resolvedSubject: tripPanelSubject,
  open: openTripPanel,
  close: closeTripPanel,
  trips: tripPanelTrips,
  rows: tripPanelRows,
  routes: tripPanelRoutes,
  title: tripPanelTitle,
  detailsLoading: tripPanelDetailsLoading,
  detailsError: tripPanelDetailsError,
  loadDetails: loadTripPanelDetails,
  clearDetails: clearTripPanelDetails,
} = useTripPanel({
  scenarioFilterResult,
  selectedDateRange,
  selectedWeekdays,
  selectedWeekdayMode,
  startTime,
  endTime,
}, tripDetailsStore)

// The panel describes the map's selection, so closing it clears that
// selection; the map in turn closes the panel when its selection goes.
const mapSelectionClearKey = ref(0)

// The full trip table, opened with the panel's subject or a Reports row's.
// Its own instance, not the panel's: a Reports row selects nothing on the map,
// and the panel describes the map's selection.
// A route's trips its report leaves out, listed too; off for each new subject.
const tripTableIncludeExcluded = ref(false)
const tripTable = reactive(useTripPanel({
  scenarioFilterResult,
  selectedDateRange,
  selectedWeekdays,
  selectedWeekdayMode,
  startTime,
  endTime,
  includeExcluded: () => tripTableIncludeExcluded.value,
}, tripDetailsStore))
const showTripTable = ref(false)
// Opened from the panel, the table goes with the panel's selection.
let tripTableFromPanel = false
const tripTableTab = ref<TripDetailsTab>('trips')
// A route subject's route, for its calculation and stop tabs.
const tripTableRoute = computed(() => {
  const s = tripTable.resolvedSubject
  return s?.kind === 'route' ? tripTable.routes.get(s.routeId) : undefined
})
// A route's title names its agency too, as routes from different agencies can
// share a name.
const tripTableTitle = computed(() => {
  const agency = tripTableRoute.value?.agency?.agency_name
  return `Trips for: ${tripTable.title}${agency ? ` · ${agency}` : ''}`
})
watch(tripPanelOpenedSubject, () => {
  if (tripTableFromPanel) {
    showTripTable.value = false
  }
})
// Every trip's details while the Trips tab is shown, as the filters change its
// trips; a route opened on its calculations or stops fetches none until then.
watch([() => tripTable.trips, showTripTable, tripTableTab], () => {
  if (showTripTable.value && tripTableTab.value === 'trips') {
    tripTable.loadDetails('all')
  }
})

// Transfers at a stop or cluster, in the Reports tab's Transfer Analyst:
// picked there, or opened from a map popup, the trip panel, or a Stop
// Clusters row.
const reportTab = ref<ReportTab>('routes')
// Loaded when first shown, as it brings Observable Plot, which no other view
// uses.
const CalTransferReport = defineAsyncComponent(() => import('~/components/cal/transfer/report.vue'))
// The subject ("transferAt") and its stop edits ("transferStops": "+id",
// "-id") live in the URL, so a link shares the analysis. A new subject starts
// from its own stops and clears the trip filters, which could also hide its
// trips.
const transferSubject = computed({
  get: () => query.value.transferAt?.toString() ?? '',
  set: (v: string) => {
    if (v !== transferSubject.value) {
      transfers.settings = { ...transfers.settings, excludedFrom: [], excludedTo: [] }
    }
    setQuery({ transferAt: v || undefined, transferStops: undefined })
  },
})
// The date shown ("transferDate"), in the URL too.
const transferDate = computed({
  get: () => query.value.transferDate?.toString() || undefined,
  set: (v: string | undefined) => { setQuery({ transferDate: v || undefined }) },
})
const transferStopEdits = computed<TransferStopEdits>({
  get: () => {
    const parts = (query.value.transferStops?.toString() ?? '').split(',').filter(Boolean)
    const ids = (sign: string) => parts.filter(p => p.startsWith(sign)).map(p => Number(p.slice(1))).filter(Number.isFinite)
    return { added: ids('+'), removed: ids('-') }
  },
  set: ({ added, removed }) => {
    const value = [...added.map(id => `+${id}`), ...removed.map(id => `-${id}`)].join(',')
    setQuery({ transferStops: value || undefined })
  },
})
const transfers = reactive(useSubjectTransfers({
  subject: () => transferSubjectFromKey(transferSubject.value),
  scenarioFilterResult,
  selectedDateRange,
  selectedWeekdays,
  selectedWeekdayMode,
  startTime,
  endTime,
  active: () => activeTab.value.tab === 'report' && reportTab.value === 'transfers',
  stopEdits: transferStopEdits,
  selectedDate: transferDate,
}, tripDetailsStore))
// The query's area: the chosen boundaries, or the bounding box.
const transferExtent = computed((): GeoJSON.Feature[] => {
  if (geographyIds.value.length > 0) {
    return (censusGeographiesSelected.value || [])
      .filter(g => g.geometry)
      .map(g => ({ type: 'Feature' as const, geometry: g.geometry as GeoJSON.Geometry, properties: {} }))
  }
  const b = bbox.value
  if (!b?.valid) {
    return []
  }
  const ring = [[b.sw.lon, b.sw.lat], [b.ne.lon, b.sw.lat], [b.ne.lon, b.ne.lat], [b.sw.lon, b.ne.lat], [b.sw.lon, b.sw.lat]]
  return [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }]
})
const transferView = ref<TransferReportView>('summary')
// The Compass view's flows, worked out only while it shows.
const EMPTY_ROSE: TransferRose = { places: [], flows: [], from: new Map(), to: new Map() }
const transferSection = ref<TransferReportSection>()
// A link to the analysis as shown: the current URL, which holds the subject,
// its stops, the date, and the times, plus the view and any settings that
// differ from the defaults, read once when the link opens.
function transferShareUrl (): string {
  const url = new URL(window.location.href)
  const settings = encodeTransferSettings(transfers.settings)
  for (const [key, value] of [['transferView', transferView.value === 'summary' ? undefined : transferView.value], ['transferSettings', settings]] as const) {
    if (value) {
      url.searchParams.set(key, value)
    } else {
      url.searchParams.delete(key)
    }
  }
  return url.href
}
if (query.value.transferView || query.value.transferSettings) {
  const shared = query.value.transferView?.toString()
  if (shared === 'individual' || shared === 'compass') {
    transferView.value = shared
  }
  if (query.value.transferSettings) {
    transfers.settings = decodeTransferSettings(query.value.transferSettings.toString())
  }
  setQuery({ transferView: undefined, transferSettings: undefined })
}
if (query.value.transferAt) {
  reportTab.value = 'transfers'
}
// Turns stop clustering on at its default distance, which refetches only the
// clusters and keeps the rest of the scenario.
function enableClustersForTransfers () {
  clusterDistance.value = STOP_CLUSTER_DEFAULT_DISTANCE
}
// Opens the Transfer Analyst at a subject. A cluster opens Stops & platforms,
// as its stops are the first thing to check; a stop leaves the settings
// closed.
function openTransfers (subject: TripSubject) {
  // The same subject again keeps its stop edits.
  const key = transferSubjectKey(subject)
  if (key !== transferSubject.value) {
    transferSubject.value = key
  }
  transferSection.value = subject.kind === 'cluster' ? 'stops' : undefined
  reportTab.value = 'transfers'
  activeTab.value = { tab: 'report', sub: '' }
}
function showTrips (subject: TripSubject, fromPanel: boolean, tab: TripDetailsTab = 'trips') {
  tripTable.open(subject)
  tripTableFromPanel = fromPanel
  tripTableTab.value = tab
  tripTableIncludeExcluded.value = false
  showTripTable.value = true
  // Also asked for here: reopening on the same subject changes nothing the
  // watch below sees. Details already asked for are not fetched again.
  if (tab === 'trips') {
    tripTable.loadDetails('all')
  }
}
function openTripTable (tab: TripDetailsTab = 'trips') {
  if (tripPanelOpenedSubject.value) {
    showTrips(tripPanelOpenedSubject.value, true, tab)
  }
}
function openReportTrips (subject: TripSubject, tab: TripDetailsTab = 'trips') {
  showTrips(subject, false, tab)
}
function onTripPanelClose () {
  closeTripPanel()
  mapSelectionClearKey.value++
}

// Once the scenario finishes loading, drop a Transfer Analyst subject it
// lacks (from a link for another area or older data, say), with its stop
// edits. Check the stops and clusters as loaded, not as filtered, so a
// subject that a filter leaves without service stays.
watch(() => [scenarioData.value, scenarioData.value?.stops.length, scenarioData.value?.stopClusters?.length, runInFlight.value, refetchInFlight.value] as const, ([data, _stops, _clusters, running, refetching]) => {
  const subject = transferSubjectFromKey(transferSubject.value)
  if (!subject || !data || running > 0 || refetching > 0) {
    return
  }
  const known = subject.kind === 'stop'
    ? data.stops.some(s => s.id === subject.stopId)
    : subject.kind === 'cluster' && (data.stopClusters ?? []).some(c => c.id === subject.clusterId)
  if (!known) {
    transferSubject.value = ''
  }
})

//////////////////////
// Helpers
//////////////////////

async function resetFilters () {
  await setQuery({
    selectedAgencies: undefined,
    startTime: undefined,
    endTime: undefined,
    selectedWeekdays: undefined,
    selectedWeekdayMode: undefined,
    selectedRouteTypes: undefined,
    frequencyUnder: undefined,
    frequencyOver: undefined,
    stopVisitsUnder: undefined,
    stopVisitsOver: undefined,
    // Retired with the "single routes" toggle; cleared so it does not linger
    // in bookmarked or shared URLs.
    calculateFrequencyMode: undefined,
    fareCategories: undefined,
    fareMax: undefined,
    fareMin: undefined,
    // Retired with the disabled fare threshold stubs (#454).
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
    flexRiderEligibility: undefined,
    flexColorBy: undefined,
    stopBufferRadius: undefined,
    stopBufferLayer: undefined,
    // Map Display panel — every key createScenarioDisplay owns, so a cleared
    // scenario doesn't inherit an overlay configured for the last one.
    showAggAreas: undefined,
    aggClip: undefined,
    aggregateLayer: undefined,
    choroplethElement: undefined,
    shadeByDensity: undefined,
    onlyWithStops: undefined,
    showStopBuffer: undefined,
    showBbox: undefined,
    dataDisplayMode: undefined,
  })
}

// Left-rail navigation. Filter/Map/Report require a loaded scenario; Query and
// Analysis are always available. The disabled styling/labels derive from
// requiresScenario so the buttons render from one template.
const menuRailItems: { tab: string, icon: string, label: string, requiresScenario: boolean }[] = [
  { tab: 'query', icon: 'magnify', label: 'Query', requiresScenario: false },
  { tab: 'filter', icon: 'filter', label: 'Filter', requiresScenario: true },
  { tab: 'map', icon: 'map', label: 'Map', requiresScenario: true },
  { tab: 'report', icon: 'file-chart', label: 'Report', requiresScenario: true },
  { tab: 'analysis', icon: 'chart-scatter-plot', label: 'Analysis', requiresScenario: false },
]

function itemHelper (p: string): string {
  if (activeTab.value.tab === p) {
    return 'is-active'
  }
  return 'is-secondary'
}
</script>

<style scoped lang="scss">
// Base tab content styling - shared by all tabs
.cal-tab-content {
  position: absolute;
  top: 0;
  left: 0;
  // cal-build-banner publishes its height; 0px when it is not shown.
  height: calc(100vh - var(--cal-build-banner-height, 0px));
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
