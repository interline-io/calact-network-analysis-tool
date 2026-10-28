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
            :saved-geography-manage-url="savedGeographyManageUrl"
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
          <analysis-picker
            :scenario-data="scenarioData"
            :scenario-config="scenarioConfig"
            :fetch-mode="fetchMode"
            @cancel="setTab({ tab: 'query', sub: '' })"
          />
        </div>

        <!-- This is a component for displaying the map and legend -->
        <cal-map
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
              :row="selectedPanelData?.row ?? null"
              :layer-label="aggregateLayerLabel"
              :geography="selectedPanelData?.geography ?? null"
              :analysis-area="analysisAreaPanelData"
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
import { useQuery, useLazyQuery } from '@vue/apollo-composable'
import { useFlexDisplayFeatures } from '~/composables/useFlexDisplayFeatures'
import { useBufferDetails } from '~/composables/useBufferDetails'
import { createTripDetailsStore, useTripPanel } from '~/composables/useTripPanel'
import type { TripDetailsTab } from '~/components/cal/trip-details.vue'
import type { TransferReportSection, TransferReportView } from '~/components/cal/transfer/report.vue'
import type { ReportTab } from '~/components/cal/report.vue'
import { transferSubjectFromKey, transferSubjectKey, useSubjectTransfers, type TransferStopEdits } from '~/composables/useSubjectTransfers'
import { useStopBufferFeatures } from '~/composables/useStopBufferFeatures'
import { useCensusGeographyLayers } from '~/composables/useCensusGeographyLayers'
import { useQueryGeography } from '~/composables/useQueryGeography'
import { useFetchMode } from '~/composables/useFetchMode'
import {
  geographyLayerQuery,
  geographyBboxQuery,
  stopGeoAggregateCsv,
  routesById,
  parseFvids,
  fareCategoryLabels,
  formatFareAmount,
} from '~~/src/tl'
import type {
  CensusDataset,
  CensusGeography,
} from '~~/src/tl'
import {
  type Bbox,
  type Point,
  type Feature,
  type AgencyFilterItem,
  routeTypeNames,
  fmtDate,
  fmtTime,
  convertBbox,
  SCENARIO_DEFAULTS,
  censusLayerLabels,
  formatAcsDatasetLabel,
  censusApportionGeometry,
  censusApportionRatio,
  censusPanelAnalysisArea,
  censusPanelGeography,
  censusGeographyMapToEntries,
  type CensusGeographyEntry,
  type FilterTag,
  QUERY_PANEL_WIDTH,
  FILTER_COLLAPSED_WIDTH,
  FILTER_EXPANDED_WIDTH,
  STOP_CLUSTER_DEFAULT_DISTANCE,
} from '~~/src/core'
import { useRouter } from '#imports'
import { getSelectedDateRange, type ScenarioConfig, type ScenarioData, type ScenarioFilter, type ScenarioFilterResult, type TripSubject, decodeTransferSettings, encodeTransferSettings } from '~~/src/scenario'

// Initialize composables
const { query, setQuery } = useUrlQuery()
const {
  showAggAreas,
  aggClipMode,
  aggregateLayer,
  onlyWithStops,
  showBbox,
} = useScenarioDisplay()
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
  includeCensus,
  fvids,
  stopBufferRadius,
  stopBufferLayer,
  clusterDistance,
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
  stopVisitsUnder,
  stopVisitsOver,
  selectedFareCategories,
  fareMax,
  fareMin,
  clusterMaxTransferMinutes,
} = useScenarioFilters()

definePageMeta({
  layout: false
})

const router = useRouter()

// Clears all loaded scenario and analysis result state
function clearScenario () {
  const { clearAllResults } = useAnalysisResults()
  scenarioData.value = undefined
  scenarioFilterResult.value = undefined
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

// Scenario data ref - the central scenario data graph, populated by fetchScenario.
// Defined early so it can be passed into the run / flex / refetch composables below.
// shallowRef + markRaw: scenario data is huge and updated only by whole-shell
// replacement (getCurrentData returns a fresh object per batch), so deep
// proxying would add tracking overhead on every stop/route/departure read
// without enabling anything.
const scenarioData = shallowRef<ScenarioData>()

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

// Flex (demand-responsive) display features for the map and Reports tab are
// derived by useFlexDisplayFeatures — wired up below, once scenarioFilterResult
// is defined (see flexDisplayFeatures / flexFeaturesForReport).

/////////////////
// Geography datasets
/////////////////

// The query area from a saved or uploaded boundary, and the census
// geographies it (or the Administrative boundaries mode) names. The geoid
// check reads the census geographies, so it takes them lazily.
const {
  savedGeographyAccess,
  savedGeographyLoading,
  savedSelectionRunnable,
  savedSelectionKind,
  savedGeographyManageUrl,
  queryPolygon,
  queryGeographyIds,
  queryAreaName,
  queryGeographyMessages,
  savedGeographyLoads,
  rememberSavedGeography,
} = useQueryGeography(() => censusGeographiesSelected.value)
const { censusGeographyLayerOptions, censusGeographiesSelected } = useCensusGeographyLayers(queryGeographyIds)

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
const selectedDateRange = computed(() => getSelectedDateRange(scenarioConfig.value))

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

// Internal state for streaming scenario data (scenarioData is defined earlier).
const scenarioFilterResult = shallowRef<ScenarioFilterResult | undefined>(undefined)
const exportFeatures = shallowRef<Feature[]>([])

// Flex display features (map + Reports tab). Instantiated here because it
// depends on scenarioFilterResult; consumed by the map and report components.
const { flexDisplayFeatures, flexFeaturesForReport } = useFlexDisplayFeatures({ scenarioData, scenarioFilterResult })

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
  if (shared === 'individual') {
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

const { stopBufferFeatures } = useStopBufferFeatures({ scenarioFilterResult })

const { choroplethClassification, choroplethFeatures } = useChoroplethClassification({
  choroplethAggregateData,
  censusGeographies: computed(() => scenarioFilterResult.value?.censusGeographies),
  choroplethGeoResult,
  selectedAggregationGeoid,
})

// Whether runs fetch through the BFF or straight from the browser.
const fetchMode = useFetchMode()

// The scenario run lifecycle owns the loading/progress state, the streaming
// fetch, and the shared receiver that the refetch composables reuse.
const {
  scenarioReceiver,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  refetchInFlight,
  runInFlight,
  stopDepartureCount,
  runQuery: runScenarioQuery,
} = useScenarioRun({ scenarioData, scenarioFilterResult, scenarioConfig, scenarioFilter, fetchMode })

// Debounced standalone recomputes that stream into the same receiver without
// re-running the whole scenario.
useBufferRefetch({
  scenarioReceiver,
  scenarioData,
  scenarioConfig,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  refetchInFlight,
  runInFlight,
  fetchMode,
})

// recompute clusters when the distance changes, reusing the same receiver.
useClusterRefetch({
  scenarioReceiver,
  scenarioData,
  scenarioConfig,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  refetchInFlight,
  runInFlight,
  fetchMode,
})

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

// reload each stop's census geography when the Aggregate-by layer changes —
// the phase fetches one layer, so the previous one's entries no longer match.
useStopCensusRefetch({
  scenarioReceiver,
  scenarioData,
  scenarioConfig,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  refetchInFlight,
  runInFlight,
  fetchMode,
})

// recompute census values when the Aggregate-by layer or the stop buffer radius
// changes, and on demand from the Map Display refresh, reusing the same receiver.
const { refresh: refreshCensusClip } = useAggregateRefetch({
  scenarioReceiver,
  scenarioData,
  scenarioConfig,
  loadingProgress,
  showLoadingModal,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  refetchInFlight,
  runInFlight,
  fetchMode,
  markedStopIds,
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

//////////////////////
// Helpers
//////////////////////

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
    // Map Display panel — every key useScenarioDisplay owns, so a cleared
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
