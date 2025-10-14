<template>
  <NuxtLayout name="default">
    <template #breadcrumbs />
    <template #footer />
    <template #menu-items>
      <ul class="menu-list">
        <li>
          <a :class="itemHelper('query')" title="Query" role="button" @click="setTab({ tab: 'query', sub: '' })">
            <o-icon
              icon="magnify"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('filter'), { 'is-disabled': !hasScenarioData }]"
            :title="hasScenarioData ? 'Filter' : 'Filter (Run a query first)'"
            role="button"
            @click="hasScenarioData ? setTab({ tab: 'filter', sub: '' }) : null"
          >
            <o-icon
              icon="filter"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('map'), { 'is-disabled': !hasScenarioData }]"
            :title="hasScenarioData ? 'Map' : 'Map (Run a query first)'"
            role="button"
            @click="hasScenarioData ? setTab({ tab: 'map', sub: '' }) : null"
          >
            <o-icon
              icon="map"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a
            :class="[itemHelper('report'), { 'is-disabled': !hasScenarioData }]"
            :title="hasScenarioData ? 'Report' : 'Report (Run a query first)'"
            role="button"
            @click="hasScenarioData ? setTab({ tab: 'report', sub: '' }) : null"
          >
            <o-icon
              icon="file-chart"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('analysis')" title="Analysis" role="button" @click="setTab({ tab: 'analysis', sub: '' })">
            <o-icon
              icon="chart-scatter-plot"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
      </ul>
    </template>

    <template #main>
      <div style="position:relative">
        <div v-if="activeTab.tab === 'query'" class="cal-tab-content cal-tab-query">
          <cal-query
            v-model:start-date="startDate"
            v-model:end-date="endDate"
            v-model:geom-source="geomSource"
            v-model:schedule-enabled="scheduleEnabled"
            v-model:geography-ids="geographyIds"
            v-model:canned-bbox="cannedBbox"
            v-model:aggregate-layer="aggregateLayer"
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

        <div v-if="activeTab.tab === 'filter'" class="cal-tab-content cal-tab-filter">
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
            :scenario-filter-result="scenarioFilterResult"
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
            @click-filter-link="setTab({ tab: 'filter', sub: 'data-display' })"
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
          @set-bbox="bbox = $event"
          @set-map-extent="setMapExtent"
          @set-export-features="exportFeatures = $event"
        />
      </div>

      <!-- Loading Progress Modal - positioned at the end for highest z-index -->
      <tl-modal
        v-model="showLoadingModal"
        title="Loading"
        :closable="false"
        :active="showLoadingModal"
      >
        <cal-scenario-loading
          :progress="loadingProgress"
          :error="error"
          :stop-departure-count="stopDepartureCount"
          :scenario-data="scenarioData"
        />
      </tl-modal>
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { nextMonday, nextSunday } from 'date-fns'
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { useApiFetch } from '~/composables/useApiFetch'
import { navigateTo, useToastNotification, useRouter } from '#imports'
import { type CensusDataset, type CensusGeography, geographyLayerQuery } from '~/src/tl'
import { type Bbox, type Point, type Feature, parseBbox, bboxString, type dow, dowValues, routeTypes, cannedBboxes, fmtDate, fmtTime, parseDate, parseTime, getLocalDateNoTime } from '~/src/core'
import { ScenarioStreamReceiver, applyScenarioResultFilter, type ScenarioConfig, type ScenarioData, type ScenarioFilter, type ScenarioFilterResult, ScenarioDataReceiver, type ScenarioProgress } from '~/src/scenario'

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

const scheduleEnabled = ref(true)
const cannedBbox = ref('downtown-portland')
const error = ref(null as Error | string | null)

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
  loadingProgress.value = null
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
    return route.query.geographyIds?.toString().split(',').map(p => (parseInt(p))) || []
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
    const defaultBbox = cannedBboxes.get(cannedBbox.value)?.bboxString || ''
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
  get (): number[] {
    const d = arrayParam('selectedRouteTypes', [])
    if (d.length) {
      return d.map(p => parseInt(p))
    }
    return Array.from(routeTypes.keys())
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
  get (): dow[] {
    if (!Object.prototype.hasOwnProperty.call(route.query, 'selectedDays')) {
      // if no `selectedDays` param present, check them all
      return dowValues.slice()
    } else {
      return arrayParam('selectedDays', []) as dow[]
    }
  },
  set (v: string[]) {
    // if all days are checked, just omit the param
    const days = new Set(v)
    const omit = dowValues.every(day => days.has(day))
    setQuery({ ...route.query, selectedDays: omit ? '' : v.join(',') })
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
    return parseInt(route.query.frequencyUnder?.toString() || '') || 15
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
    return parseInt(route.query.frequencyOver?.toString() || '') || 15
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
    return parseInt(route.query.maxFare?.toString() || '') || 0
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
    return parseInt(route.query.minFare?.toString() || '') || 0
  },
  set (v: string) {
    setQuery({ ...route.query, minFare: v.toString() })
  }
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

// Check if there's scenario data to display in reports
const hasScenarioData = computed(() => {
  return scenarioData.value !== null && scenarioFilterResult.value !== undefined
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
const mapExtent = ref<Bbox | null>(null)

const mapExtentCenter = computed((): Point | null => {
  const bbox = mapExtent.value
  if (bbox?.valid) {
    return {
      lon: (bbox.ne.lon + bbox.sw.lon) / 2,
      lat: (bbox.ne.lat + bbox.sw.lat) / 2
    }
  }
  return null
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
  reportName: 'Transit Network Explorer',
  bbox: bbox.value,
  scheduleEnabled: scheduleEnabled.value,
  aggregateLayer: aggregateLayer.value,
  startDate: startDate.value,
  endDate: endDate.value,
  geographyIds: geographyIds.value,
  stopLimit: 50
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
const scenarioData = ref<ScenarioData | null>(null)
const scenarioFilterResult = ref<ScenarioFilterResult | undefined>(undefined)
const exportFeatures = shallowRef<Feature[]>([])

// Loading progress tracking for modal
const loadingProgress = ref<ScenarioProgress | null>(null)
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
  loadingProgress.value = null
  stopDepartureCount.value = 0

  // Create receiver to accumulate scenario data
  const receiver = new ScenarioDataReceiver({
    onProgress: (progress: ScenarioProgress) => {
      // Update progress for modal
      loadingProgress.value = progress
      stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0

      // Apply filters to partial data and emit (without schedule-dependent features)
      // Skip if no route/stop data
      if (progress.partialData?.routes.length === 0 && progress.partialData?.stops.length === 0) {
        return
      }
      scenarioData.value = receiver.getCurrentData()
    },
    onComplete: () => {
      // Get final accumulated data and apply filters
      loadingProgress.value = null
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
  const rtypes = scenarioFilter.value.selectedRouteTypes.map(val => toTitleCase(routeTypes.get(val) || '')).filter(Boolean)
  if (rtypes.length !== routeTypes.size) {
    results.push('with route types ' + rtypes.join(', '))
  }

  // agencies
  const agencies = scenarioFilter.value.selectedAgencies
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
  const days = scenarioFilter.value.selectedDays.map(val => toTitleCase(val))
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
.cal-tab-query {
  width: calc(50vw); // Query tab - half width, map visible
}

.cal-tab-filter {
  width: 270px;
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
