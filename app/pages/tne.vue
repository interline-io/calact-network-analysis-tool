<template>
  <NuxtLayout name="default">
    <template #breadcrumbs />
    <template #footer />
    <template #menu-items>
      <ul class="menu-list">
        <li>
          <a :class="itemHelper('query')" title="Query" role="button" @click="setTab({ tab: 'query', sub: '' })">
            <t-icon
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
            <t-icon
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
            <t-icon
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
            <t-icon
              icon="file-chart"
              class="is-fullwidth"
              size="large"
              :variant="scenarioFilterResult ? 'white' : 'dark'"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('analysis')" title="Analysis" role="button" @click="setTab({ tab: 'analysis', sub: '' })">
            <t-icon
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
          <!-- @vue-skip -->
          <cal-query
            v-model:start-date="startDate"
            v-model:end-date="endDate"
            v-model:geom-source="geomSource"
            v-model:geography-ids="geographyIds"
            v-model:canned-bbox="cannedBbox"
            v-model:aggregate-layer="aggregateLayer"
            v-model:include-fixed-route="includeFixedRoute"
            v-model:include-flex-areas="includeFlexAreas"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :bbox="bbox"
            :map-extent-center="mapExtentCenter"
            :census-geographies-selected="censusGeographiesSelected"
            @set-bbox="bbox = $event"
            @explore="runQuery()"
            @load-example-data="loadExampleData"
            @switch-to-analysis-tab="setTab({ tab: 'analysis', sub: '' })"
          />
        </div>

        <div
          v-if="activeTab.tab === 'filter'"
          :class="['cal-tab-content', 'cal-tab-filter', { 'has-subtab': activeTab.sub }]"
        >
          <!-- @vue-skip -->
          <cal-filter
            v-model:start-date="startDate"
            v-model:end-date="endDate"
            v-model:start-time="startTime"
            v-model:end-time="endTime"
            v-model:base-map="baseMap"
            v-model:data-display-mode="dataDisplayMode"
            v-model:color-key="colorKey"
            v-model:unit-system="unitSystem"
            v-model:hide-unmarked="hideUnmarked"
            v-model:selected-days="selectedDays"
            v-model:selected-route-types="selectedRouteTypes"
            v-model:selected-agencies="selectedAgencies"
            v-model:selected-day-of-week-mode="selectedDayOfWeekMode"
            v-model:selected-time-of-day-mode="selectedTimeOfDayMode"
            v-model:frequency-under-enabled="frequencyUnderEnabled"
            v-model:frequency-under="frequencyUnder"
            v-model:frequency-over-enabled="frequencyOverEnabled"
            v-model:frequency-over="frequencyOver"
            v-model:calculate-frequency-mode="calculateFrequencyMode"
            v-model:max-fare-enabled="maxFareEnabled"
            v-model:max-fare="maxFare"
            v-model:min-fare-enabled="minFareEnabled"
            v-model:min-fare="minFare"
            v-model:fixed-route-enabled="fixedRouteEnabled"
            v-model:flex-services-enabled="flexServicesEnabled"
            v-model:flex-advance-notice="flexAdvanceNotice"
            v-model:flex-area-types-selected="flexAreaTypesSelected"
            v-model:flex-color-by="flexColorBy"
            :scenario-filter-result="scenarioFilterResult"
            :has-fixed-route-data="hasFixedRouteData"
            :has-flex-data="hasFlexData"
            :active-tab="activeTab.sub"
            @reset-filters="resetFilters"
          />
        </div>

        <div v-if="activeTab.tab === 'report'" class="cal-tab-content cal-tab-report">
          <cal-report
            v-model:data-display-mode="dataDisplayMode"
            v-model:aggregate-layer="aggregateLayer"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :scenario-filter-result="scenarioFilterResult"
            :export-features="exportFeatures"
            :filter-summary="filterSummary"
            :fixed-route-enabled="fixedRouteEnabled"
            :flex-services-enabled="flexServicesEnabled"
            :has-flex-data="hasFlexData"
            :flex-display-features="flexFeaturesForReport"
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
          :bbox="bbox"
          :census-geographies-selected="censusGeographiesSelected"
          :scenario-filter-result="scenarioFilterResult"
          :display-edit-bbox-mode="displayEditBboxMode"
          :data-display-mode="dataDisplayMode"
          :color-key="colorKey"
          :hide-unmarked="hideUnmarked"
          :fixed-route-enabled="fixedRouteEnabled"
          :flex-services-enabled="flexServicesEnabled"
          :flex-color-by="flexColorBy"
          :flex-display-features="flexDisplayFeatures"
          :loading-stage="loadingProgress?.currentStage"
          @set-bbox="bbox = $event"
          @set-map-extent="setMapExtent"
          @set-export-features="exportFeatures = $event"
        />
      </div>

      <!-- Loading Progress Modal - positioned at the end for highest z-index -->
      <t-modal
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
      </t-modal>
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { nextMonday } from 'date-fns'
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { useApiFetch } from '~/composables/useApiFetch'
import { useFlexAreaFormatting } from '~/composables/useFlexAreaFormatting'
import {
  getFlexAreaType,
  getFlexAdvanceNotice,
  getFlexAgencyName, geographyLayerQuery
} from '~~/src/tl'
import {
  createCategoryColorScale,
  flexColors,
} from '~~/src/core'
import { navigateTo, useToastNotification, useRouter } from '#imports'
import type { FlexAdvanceNotice, FlexAreaType, FlexAreaFeature, CensusDataset, CensusGeography } from '~~/src/tl'
import { type Bbox, type Point, type Feature, parseBbox, bboxString, type dow, dowValues, routeTypeNames, cannedBboxes, fmtDate, fmtTime, parseDate, parseTime, getLocalDateNoTime, dateToSeconds, SCENARIO_DEFAULTS, flexAdvanceNoticeTypes, flexAreaTypes } from '~~/src/core'
import { ScenarioStreamReceiver, applyScenarioResultFilter, type ScenarioConfig, type ScenarioData, type ScenarioFilter, type ScenarioFilterResult, ScenarioDataReceiver, type ScenarioProgress } from '~~/src/scenario'

// Initialize composables
const { buildFlexAreaProperties } = useFlexAreaFormatting()

definePageMeta({
  layout: false
})

const route = useRoute()
const router = useRouter()

// Shared function to check if user has analysis results and handle confirmation
function checkAnalysisResultsAndConfirm (action: string): boolean {
  const { hasAnyResults, clearAllResults } = useAnalysisResults()

  if (hasAnyResults.value) {
    console.log(`${action} blocked - has analysis results`)
    const confirmed = confirm(`You have analysis results displayed. ${action} will clear these results and you'll need to run the analysis again to see them. Do you want to continue?`)

    if (!confirmed) {
      return false
    }

    // User confirmed, clear the results state
    clearAllResults()
  }

  return true
}

// Route navigation guard to prevent leaving with analysis results
router.beforeEach((to, from, next) => {
  // Only check if we're currently on the analysis page and trying to navigate away
  if (from.path === '/tne' && activeTab.value.tab === 'analysis') {
    if (!checkAnalysisResultsAndConfirm('Navigating away')) {
      // User cancelled, stay on current page
      return false
    }
  }

  // Allow navigation to proceed
  next()
})

/////////////////
// Loading and error handling
/////////////////

const cannedBbox = computed({
  get () {
    return route.query.example?.toString() || 'downtown-portland'
  },
  set (v: string) {
    setQuery({ ...route.query, example: v || undefined })
  }
})
const error = ref(undefined as Error | string | undefined)

// Runs on explore event from query (when user clicks "Run Query")
const runQuery = async () => {
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

const geomSource = computed({
  get () {
    return route.query.geomSource?.toString() || 'bbox'
  },
  set (v: string) {
    setQuery({ ...route.query, geomSource: v })
  }
})

const geographyIds = computed({
  get () {
    return route.query.geographyIds?.toString().split(',').map(p => (Number.parseInt(p))) || []
  },
  set (v: number[]) {
    setQuery({ ...route.query, geographyIds: v.map(String).join(',') })
  }
})

const startDate = computed({
  get () {
    const today = new Date() // Or any starting date you desire
    return parseDate(route.query.startDate?.toString() || '') || nextMonday(today)
  },
  set (v: Date) {
    setQuery({ ...route.query, startDate: fmtDate(v) })
  }
})

const endDate = computed({
  get () {
    if (route.query?.endDate) {
      return parseDate(route.query.endDate?.toString() || '') || getLocalDateNoTime()
    }
    const n = new Date(startDate.value.valueOf())
    n.setDate(n.getDate() + 6)
    return n
  },
  set (v: Date) {
    setQuery({ ...route.query, endDate: fmtDate(v) })
  }
})

const startTime = computed({
  get () {
    return parseTime(route.query.startTime?.toString() || '') || parseTime('00:00:00')
  },
  set (v: Date | undefined) {
    setQuery({ ...route.query, startTime: fmtTime(v) })
  }
})

const endTime = computed({
  get () {
    return parseTime(route.query.endTime?.toString() || '') || parseTime('23:59:00')
  },
  set (v: Date | undefined) {
    setQuery({ ...route.query, endTime: fmtTime(v) })
  }
})

const bbox = computed({
  get () {
    const defaultBbox = cannedBboxes[cannedBbox.value as keyof typeof cannedBboxes]?.bboxString || ''
    const bbox = route.query.bbox?.toString() ?? defaultBbox
    return parseBbox(bbox)
  },
  set (v: Bbox) {
    setQuery({ ...route.query, bbox: bboxString(v) })
  }
})

const unitSystem = computed({
  get () {
    return route.query.unitSystem?.toString() || 'us'
  },
  set (v: string) {
    setQuery({ ...route.query, unitSystem: v })
  }
})

const aggregateLayer = computed({
  get () {
    return route.query.aggregateLayer?.toString() || 'tract'
  },
  set (v: string) {
    setQuery({ ...route.query, aggregateLayer: v })
  }
})

// Data loading toggles (Query tab > Advanced Settings)
// These control what data is fetched from the API
const includeFixedRoute = computed({
  get () {
    // Default to true (on) if not specified
    return route.query.includeFixedRoute?.toString() !== 'false'
  },
  set (v: boolean) {
    setQuery({ ...route.query, includeFixedRoute: v ? '' : 'false' })
  }
})

const includeFlexAreas = computed({
  get () {
    // Default to true (on) if not specified
    return route.query.includeFlexAreas?.toString() !== 'false'
  },
  set (v: boolean) {
    setQuery({ ...route.query, includeFlexAreas: v ? '' : 'false' })
  }
})

const hideUnmarked = computed({
  get () {
    return route.query.hideUnmarked?.toString() === 'true'
  },
  set (v: boolean) {
    setQuery({ ...route.query, hideUnmarked: v ? 'true' : '' })
  }
})

const dataDisplayMode = computed({
  get () {
    return route.query.dataDisplayMode?.toString() || 'Route'
  },
  set (v: string) {
    setQuery({ ...route.query, dataDisplayMode: v })
  }
})

const colorKey = computed({
  get () {
    return route.query.colorKey?.toString() || 'Mode'
  },
  set (v: string) {
    setQuery({ ...route.query, colorKey: v })
  }
})

const baseMap = computed({
  get () {
    return route.query.baseMap?.toString() || 'Streets'
  },
  set (v: string) {
    setQuery({ ...route.query, baseMap: v })
  }
})

const selectedDayOfWeekMode = computed({
  get () {
    return route.query.selectedDayOfWeekMode?.toString() || 'Any'
  },
  set (v: string) {
    setQuery({ ...route.query, selectedDayOfWeekMode: v === 'Any' ? '' : v })
  }
})

const selectedTimeOfDayMode = computed({
  get () {
    return route.query.selectedTimeOfDayMode?.toString() || 'All'
  },
  set (v: string) {
    setQuery({ ...route.query, selectedTimeOfDayMode: v === 'All' ? '' : v })
  }
})

const selectedRouteTypes = computed({
  get () {
    const d = arrayParam('selectedRouteTypes', [])
    if (d.length) {
      return d.map(p => Number.parseInt(p))
    }
    return Array.from(routeTypeNames.keys())
  },
  set (v: string[]) {
    setQuery({ ...route.query, selectedRouteTypes: v.join(',') })
  }
})

const selectedAgencies = computed({
  get (): string[] {
    return arrayParam('selectedAgencies', [])
  },
  set (v: string[]) {
    setQuery({ ...route.query, selectedAgencies: v.join(',') })
  }
})

const selectedDays = computed({
  get (): dow[] | undefined {
    return arrayParamOrUndefined('selectedDays') as dow[]
  },
  set (v?: string[]) {
    setQuery({ ...route.query, selectedDays: v ? v.join(',') : undefined })
  }
})

const frequencyUnderEnabled = computed({
  get () {
    return route.query.frequencyUnderEnabled?.toString() === 'true'
  },
  set (v: boolean) {
    setQuery({ ...route.query, frequencyUnderEnabled: v ? 'true' : '' })
  }
})

const frequencyUnder = computed({
  get () {
    return Number.parseInt(route.query.frequencyUnder?.toString() || '') || 15
  },
  set (v: number) {
    setQuery({ ...route.query, frequencyUnder: v.toString() })
  }
})

const frequencyOverEnabled = computed({
  get () {
    return route.query.frequencyOverEnabled?.toString() === 'true'
  },
  set (v: boolean) {
    setQuery({ ...route.query, frequencyOverEnabled: v ? 'true' : '' })
  }
})

const frequencyOver = computed({
  get () {
    return Number.parseInt(route.query.frequencyOver?.toString() || '') || 15
  },
  set (v: number) {
    setQuery({ ...route.query, frequencyOver: v.toString() })
  }
})

const calculateFrequencyMode = computed({
  get () {
    return route.query.calculateFrequencyMode?.toString() === 'true'
  },
  set (v: boolean) {
    setQuery({ ...route.query, calculateFrequencyMode: v ? 'true' : '' })
  }
})

const maxFareEnabled = computed({
  get () {
    return route.query.maxFareEnabled?.toString() === 'true'
  },
  set (v: boolean) {
    setQuery({ ...route.query, maxFareEnabled: v ? 'true' : '' })
  }
})

const maxFare = computed({
  get () {
    return Number.parseInt(route.query.maxFare?.toString() || '') || 0
  },
  set (v: number) {
    setQuery({ ...route.query, maxFare: v.toString() })
  }
})

const minFareEnabled = computed({
  get () {
    return route.query.minFareEnabled?.toString() === 'true'
  },
  set (v: string) {
    setQuery({ ...route.query, minFareEnabled: v ? 'true' : '' })
  }
})

const minFare = computed({
  get () {
    return Number.parseInt(route.query.minFare?.toString() || '') || 0
  },
  set (v: string) {
    setQuery({ ...route.query, minFare: v.toString() })
  }
})

/////////////////
// Fixed-Route Transit toggle
/////////////////

const fixedRouteEnabled = computed({
  get () {
    // On by default - only false if explicitly set to 'false'
    return route.query.fixedRouteEnabled?.toString() !== 'false'
  },
  set (v: boolean) {
    setQuery({ ...route.query, fixedRouteEnabled: v ? '' : 'false' })
  }
})

/////////////////
// Flex Services (DRT) filters
// TODO: Integrate with transitland-server GraphQL resolvers for GTFS-Flex data
// Related PR: https://github.com/interline-io/transitland-lib/pull/527
// Will query: booking_rules.booking_type, stop_times.pickup_type/drop_off_type
// Polygons come from locations.geojson linked via stop_times.location_id
/////////////////

const flexServicesEnabled = computed({
  get () {
    // Default: off when showing fixed-route, on when only showing flex
    const param = route.query.flexServicesEnabled?.toString()
    if (param === 'true') return true
    if (param === 'false') return false
    // No explicit param - default based on includeFixedRoute
    return !includeFixedRoute.value
  },
  set (v: boolean) {
    setQuery({ ...route.query, flexServicesEnabled: v ? 'true' : 'false' })
  }
})

const flexAdvanceNotice = computed({
  get (): string[] {
    // All selected by default per PRD (when param is not present)
    // Maps to booking_rules.booking_type: 0=On-Demand, 1=Same Day, 2=More than 24 hours
    // Use special marker '__none__' to indicate user explicitly unchecked all
    const param = route.query.flexAdvanceNotice?.toString()
    if (param === '__none__') {
      return [] // User explicitly unchecked all
    }
    if (!param) {
      return ['On-demand', 'Same day', 'More than 24 hours'] // Default: all selected
    }
    return param.split(',').filter(Boolean)
  },
  set (v: string[]) {
    // Use special marker when all are unchecked to distinguish from "not set"
    const value = v.length === 0 ? '__none__' : v.join(',')
    setQuery({ ...route.query, flexAdvanceNotice: value })
  }
})

const flexAreaTypesSelected = computed({
  get (): string[] {
    // All selected by default per PRD (when param is not present)
    // Based on stop_times.pickup_type and drop_off_type
    // Use special marker '__none__' to indicate user explicitly unchecked all
    const param = route.query.flexAreaTypesSelected?.toString()
    if (param === '__none__') {
      return [] // User explicitly unchecked all
    }
    if (!param) {
      return ['PU only', 'DO only', 'PU and DO'] // Default: all selected
    }
    return param.split(',').filter(Boolean)
  },
  set (v: string[]) {
    // Use special marker when all are unchecked to distinguish from "not set"
    const value = v.length === 0 ? '__none__' : v.join(',')
    setQuery({ ...route.query, flexAreaTypesSelected: value })
  }
})

const flexColorBy = computed({
  get () {
    // Agency coloring by default per PRD
    // Can also color by Advance notice (booking_type category)
    // Future: add service quality heatmap using safe_duration_factor/safe_duration_offset
    return route.query.flexColorBy?.toString() || 'Agency'
  },
  set (v: string) {
    setQuery({ ...route.query, flexColorBy: v === 'Agency' ? '' : v })
  }
})

// Scenario data ref - defined early so flex computed properties can reference it
// This is populated when fetchScenario runs
const scenarioData = ref<ScenarioData>()

// Flex areas filtering and styling (inline, similar to how fixed-route uses applyScenarioResultFilter)
// Raw data comes from scenario stream via scenarioData.flexAreas

const flexAgencyNames = computed(() => {
  const names = new Set<string>()
  for (const feature of scenarioData.value?.flexAreas || []) {
    const name = getFlexAgencyName(feature)
    if (name) names.add(name)
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
  const advanceNoticeFilter = flexAdvanceNotice.value.filter(
    (v): v is FlexAdvanceNotice => flexAdvanceNoticeTypes.includes(v as FlexAdvanceNotice)
  )
  const areaTypesFilter = flexAreaTypesSelected.value.filter(
    (v): v is FlexAreaType => flexAreaTypes.includes(v as FlexAreaType)
  )

  const featureAreaType = getFlexAreaType(feature)
  if (!areaTypesFilter.includes(featureAreaType)) return false

  const featureAdvanceNotice = getFlexAdvanceNotice(feature)
  if (!advanceNoticeFilter.includes(featureAdvanceNotice)) return false

  // Time-of-day filtering for flex areas
  const applyTimeFilter = selectedTimeOfDayMode.value !== 'All'
  if (applyTimeFilter) {
    const userStartSeconds = dateToSeconds(startTime.value)
    const userEndSeconds = dateToSeconds(endTime.value)
    const flexStart = feature.properties.time_window_start
    const flexEnd = feature.properties.time_window_end

    // If flex area has time windows defined and user has set time filters, check for overlap
    if (flexStart !== undefined && flexEnd !== undefined
      && userStartSeconds !== undefined && userEndSeconds !== undefined) {
      const noOverlap = flexEnd < userStartSeconds || flexStart > userEndSeconds
      if (noOverlap) return false
    }
  }

  return true
}

// All flex areas with their "marked" status (matches filters)
// Base computed that always calculates marked status (independent of map toggle)
const flexAreasWithMarkedBase = computed(() => {
  return (scenarioData.value?.flexAreas || []).map(feature => ({
    feature,
    marked: flexAreaMatchesFilters(feature)
  }))
})

// Flex areas for map display (respects flexServicesEnabled toggle)
const flexAreasWithMarked = computed(() => {
  if (!flexServicesEnabled.value) return []
  return flexAreasWithMarkedBase.value
})

// Flex areas for Reports tab (always available if data exists, independent of map toggle)
const flexAreasWithMarkedForReport = computed(() => {
  return flexAreasWithMarkedBase.value
})

const flexDisplayFeatures = computed((): Feature[] => {
  if (!flexServicesEnabled.value) return []

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
    geography_ids: geographyIds.value,
    include_geographies: geographyIds.value.length > 0,
  })
)

const censusGeographyLayerOptions = computed(() => {
  const geomDatasets = censusGeographyResult.value?.census_datasets || []
  const options = []
  for (const ds of geomDatasets || []) {
    for (const layer of ds.layers || []) {
      const label = `${ds.description || ds.name}: ${layer.description || layer.name}`
      options.push({ value: layer.name, label: label })
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

/////////////////////////
// Event passing
/////////////////////////

// Tab handling
const activeTab = ref({ tab: 'query', sub: '' })

// Advanced report query parameter support
const advancedReport = computed({
  get () {
    return route.query.advancedReport?.toString() || ''
  },
  set (v: string) {
    setQuery({ ...route.query, advancedReport: v || undefined })
  }
})

watch([activeTab, geomSource], () => {
  if (activeTab.value.tab === 'query' && geomSource.value === 'bbox') {
    displayEditBboxMode.value = true
  } else {
    displayEditBboxMode.value = false
  }
})

// Initialize displayEditBboxMode based on initial values
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
    if (!checkAnalysisResultsAndConfirm('Switching tabs')) {
      return
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
  if (geomSource.value === 'mapExtent') {
    bbox.value = mapExtent.value
  }
}

////////////////////////////
// Scenario
////////////////////////////

// Computed properties for config and filter to avoid duplication
const scenarioConfig = computed((): ScenarioConfig => ({
  geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
  reportName: 'Transit Network Explorer',
  bbox: bbox.value,
  aggregateLayer: aggregateLayer.value,
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
  selectedRouteTypes: selectedRouteTypes.value || [],
  selectedDays: selectedDays.value || [],
  selectedAgencies: selectedAgencies.value || [],
  selectedDayOfWeekMode: selectedDayOfWeekMode.value || '',
  selectedTimeOfDayMode: '', // Not used in the original component
  frequencyUnder: frequencyUnder.value,
  frequencyOver: frequencyOver.value,
  frequencyUnderEnabled: frequencyUnderEnabled.value || false,
  frequencyOverEnabled: frequencyOverEnabled.value || false
}))

// Internal state for streaming scenario data
// Note: scenarioData is defined earlier in the file (before useFlexAreas)
const scenarioFilterResult = ref<ScenarioFilterResult | undefined>(undefined)
const exportFeatures = shallowRef<Feature[]>([])

// Data availability indicators for filter panel
const hasFixedRouteData = computed(() => {
  return !!(scenarioFilterResult.value?.stops?.length || scenarioFilterResult.value?.routes?.length)
})
const hasFlexData = computed(() => {
  return !!(scenarioData.value?.flexAreas?.length)
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
  console.log('fetchScenario:', loadExample)
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
    const apiFetch = await useApiFetch()
    response = await apiFetch('/api/scenario', {
      method: 'POST',
      body: JSON.stringify(config)
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
  await streamer.processStream(response.body, receiver)
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
// Filter summary
/////////////////

// Each result in the filter summary will be a string to be used as a bullet point.
// We will only include results if the filter is set to something interesting (not default)
const filterSummary = computed((): string[] => {
  // const mode = dataDisplayMode.value
  const results: string[] = []

  // route types
  const rtypes = (scenarioFilter.value.selectedRouteTypes ?? []).map(val => toTitleCase(routeTypeNames.get(val) || '')).filter(Boolean)
  if (rtypes.length !== routeTypeNames.size) {
    results.push('with route types ' + rtypes.join(', '))
  }

  // agencies
  const agencies = scenarioFilter.value.selectedAgencies ?? []
  if (agencies.length) {
    results.push('operated by ' + agencies.join(', '))
  }

  // date range
  const today = fmtDate(getLocalDateNoTime(), 'P')
  const sdate = fmtDate(scenarioConfig.value.startDate, 'P') || today
  const edate = fmtDate(scenarioConfig.value.endDate, 'P') || today
  if (sdate !== today && edate !== today && sdate !== edate) {
    results.push('operating between ' + sdate + ' and ' + edate)
  } else if (sdate !== today && edate !== today && sdate === edate) {
    results.push('operating on ' + sdate)
  } else if (sdate !== today && edate === today) {
    results.push('operating after ' + sdate)
  }

  // days of week  (always show something here)
  const days = (scenarioFilter.value.selectedDays ?? []).map(val => toTitleCase(val))
  const dowMode = scenarioFilter.value.selectedDayOfWeekMode
  if (dowMode === 'All' /* && days.length !== 7 */) {
    results.push('operating all of ' + days.join(', '))
  } else if (dowMode === 'Any') {
    results.push('operating any of ' + days.join(', '))
  }

  // time range
  if (scenarioFilter.value.selectedTimeOfDayMode !== 'All') {
    const stime = fmtTime(scenarioFilter.value.startTime, 'p')
    const etime = fmtTime(scenarioFilter.value.endTime, 'p')
    if (stime && etime && stime !== etime) {
      results.push('operating between ' + stime + ' and ' + etime)
    } else if (stime && etime && stime === etime) {
      results.push('operating at ' + stime)
    } else if (stime && !etime) {
      results.push('operating after ' + stime)
    } else if (etime && !stime) {
      results.push('operating before ' + etime)
    }
  }

  // frequencies
  const hasMinFreq = scenarioFilter.value.frequencyOverEnabled
  const minFreq = scenarioFilter.value.frequencyOver
  const hasMaxFreq = scenarioFilter.value.frequencyUnderEnabled
  const maxFreq = scenarioFilter.value.frequencyUnder
  if (hasMinFreq && hasMaxFreq && minFreq !== maxFreq) {
    results.push('with frequency between ' + minFreq + ' and ' + maxFreq + ' minutes')
  } else if (hasMinFreq && hasMaxFreq && minFreq === maxFreq) {
    results.push('with frequency exactly ' + minFreq + ' minutes')
  } else if (hasMinFreq && !hasMaxFreq) {
    results.push('with frequency at least ' + minFreq + ' minutes')
  } else if (hasMaxFreq && !hasMinFreq) {
    results.push('with frequency less than ' + maxFreq + ' minutes')
  }

  // fares
  const hasMinFare = minFareEnabled.value
  const minDollar = minFare.value
  const hasMaxFare = maxFareEnabled.value
  const maxDollar = maxFare.value
  if (hasMinFare && hasMaxFare && minDollar !== maxDollar) {
    results.push('with fare between $' + minDollar + ' and $' + maxDollar)
  } else if (hasMinFare && hasMaxFare && minDollar === maxDollar) {
    results.push('with fare exactly $' + minDollar)
  } else if (hasMinFare && !hasMaxFare) {
    results.push('with fare at least $' + minDollar)
  } else if (hasMaxFare && !hasMinFare) {
    results.push('with fare less than $' + maxDollar)
  }

  return results
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
    startTime: '',
    endTime: '',
    selectedAgencies: '',
    // selectedDays: '',
    selectedRouteTypes: '',
    selectedDayOfWeekMode: '',
    selectedTimeOfDayMode: '',
    frequencyUnderEnabled: '',
    frequencyUnder: '',
    frequencyOverEnabled: '',
    frequencyOver: '',
    calculateFrequencyMode: '',
    maxFareEnabled: '',
    maxFare: '',
    minFareEnabled: '',
    minFare: '',
    colorKey: '',
    unitSystem: '',
    hideUnmarked: '',
    baseMap: '',
    // Fixed-Route and Flex Services filters
    fixedRouteEnabled: '',
    flexServicesEnabled: '',
    flexAdvanceNotice: '',
    flexAreaTypesSelected: '',
    flexColorBy: '',
  })
  // Note, `selectedDays` is special, see note below.
  // When clearing filters, it should removed, not set to ''
  delete p.selectedDays
  await navigateTo({ replace: true, query: p })
}

function removeEmpty (v: Record<string, any>): Record<string, any> {
  // Note, `selectedDays` is special - we want to allow it to be empty string ''.
  // That means the user unchecked all the days.
  // Removing it would re-check all the days.
  // todo: improve?
  const r: Record<string, any> = {}
  for (const k in v) {
    if (v[k] || k === 'selectedDays') {
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

function arrayParam (p: string, def: string[]): string[] {
  const a = route.query[p]?.toString().split(',').filter(p => (p)) || []
  return a.length > 0 ? a : def
}

function arrayParamOrUndefined (p: string): string[] | undefined {
  if (!Object.prototype.hasOwnProperty.call(route.query, p)) {
    return undefined
  }
  const a = route.query[p]?.toString().split(',').filter(p => (p)) || []
  return a
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
  width: 270px; /* Default width when no subtab is open */
  min-width: 270px;

  &.has-subtab {
    width: 670px; /* Expanded width when subtab is open: main panel (250px) + sub-panel (400px) + padding (20px) */
    min-width: 670px;
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
</style>

<style>
/* Ensure modal is always on top */
.tl-modal {
  z-index: 99999 !important;
}
</style>
