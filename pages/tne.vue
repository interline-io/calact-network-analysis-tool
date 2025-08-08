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
          <a :class="itemHelper('filter')" title="Filter" role="button" @click="setTab({ tab: 'filter', sub: '' })">
            <o-icon
              icon="filter"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('map')" title="Map" role="button" @click="setTab({ tab: 'map', sub: '' })">
            <o-icon
              icon="map"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a :class="itemHelper('report')" title="Report" role="button" @click="setTab({ tab: 'report', sub: '' })">
            <o-icon
              icon="file-chart"
              class="is-fullwidth"
              size="large"
            />
          </a>
        </li>
        <li>
          <a v-if="stopDepartureProgress.queue > 0 || loading" class="menu-item" style="color:white;text-align:center">
            <img src="~assets/spinner.svg" alt="Loading">
          </a>
        </li>
      </ul>
    </template>

    <template #main>
      <!-- Loading and error handling -->
      <!-- <o-loading
        :active="loading"
        :full-page="true"
      >
        <img src="~assets/spinner.svg" alt="Loading">
      </o-loading> -->

      <tl-modal
        v-model="hasError"
        title="Error"
      >
        <tl-msg-error title="There was an error :(">
          {{ error }}
        </tl-msg-error>
      </tl-modal>

      <div style="position:relative">
        <div v-if="activeTab.tab === 'query'" class="cal-overlay">
          <cal-query
            v-model:start-date="startDate"
            v-model:end-date="endDate"
            v-model:geom-source="geomSource"
            v-model:geom-layer="geomLayer"
            v-model:schedule-enabled="scheduleEnabled"
            v-model:geography-ids="geographyIds"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :bbox="bbox"
            :map-extent-center="mapExtentCenter"
            :census-geographies-selected="censusGeographiesSelected"
            @set-bbox="bbox = $event"
            @explore="runQuery()"
          />
        </div>

        <div v-if="activeTab.tab === 'filter'" class="cal-overlay">
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
            :stop-departure-loading-complete="stopDepartureLoadingComplete"
            :stop-features="stopFeatures"
            :agency-features="agencyFeatures"
            :active-tab="activeTab.sub"
            @reset-filters="resetFilters"
          />
        </div>

        <div v-if="activeTab.tab === 'report'" class="cal-overlay">
          <cal-report
            v-model:data-display-mode="dataDisplayMode"
            v-model:aggregate-mode="geomLayer"
            :census-geography-layer-options="censusGeographyLayerOptions"
            :stop-features="stopFeatures"
            :route-features="routeFeatures"
            :agency-features="agencyFeatures"
            :export-features="exportFeatures"
            :filter-summary="filterSummary"
            :stop-departure-loading-complete="stopDepartureLoadingComplete"
            @click-filter-link="setTab({ tab: 'filter', sub: 'data-display' })"
          />
        </div>
      </div>

      <!-- This is a component for displaying the map and legend -->
      <cal-map
        :bbox="bbox"
        :census-geographies-selected="censusGeographiesSelected"
        :stop-features="stopFeatures"
        :route-features="routeFeatures"
        :agency-features="agencyFeatures"
        :display-edit-bbox-mode="displayEditBboxMode"
        :data-display-mode="dataDisplayMode"
        :color-key="colorKey"
        :hide-unmarked="hideUnmarked"
        :stop-departure-loading-complete="stopDepartureLoadingComplete"
        @set-bbox="bbox = $event"
        @set-map-extent="setMapExtent"
        @set-export-features="exportFeatures = $event"
      />
    </template>
  </NuxtLayout>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { navigateTo } from '#imports'

import type { CensusDataset, CensusGeography } from '~/src/census'
import { type Bbox, type Point, type Feature, bboxString } from '~/src/geom'
import { fmtDate, fmtTime, parseDate, getLocalDateNoTime } from '~/src/datetime'
import type { Stop } from '~/src/stop'
import type { Route } from '~/src/route'
import type { Agency } from '~/src/agency'
import { type dow, dowValues, routeTypes } from '~/src/constants'
import { applyScenarioResultFilter, type ScenarioConfig, type ScenarioFilter } from '~/src/scenario-fetcher'
import { StopDepartureCache } from '~/src/departure-cache'

definePageMeta({
  layout: false
})

const route = useRoute()

/////////////////

const scheduleEnabled = ref(true)
const defaultBbox = '-122.69075,45.51358,-122.66809,45.53306'
const runCount = ref(0)

/////////////////
// Query parameters using the composable
const {
  stringParam,
  booleanParam,
  numberParam,
  arrayParam,
  dateParam,
  timeParam,
  bboxParam,
  setQuery
} = useQueryParams()

// Configuration parameters
const geomSource = stringParam('geomSource', 'bbox')
const geomLayer = stringParam('geomLayer', 'place')
const geographyIds = computed({
  get (): number[] {
    return route.query.geographyIds?.toString().split(',').map(p => parseInt(p)).filter(Boolean) || []
  },
  set (v: number[]) {
    setQuery({ geographyIds: v.map(String).join(',') })
  }
})
const startDate = dateParam('startDate', getLocalDateNoTime())
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
    setQuery({ endDate: fmtDate(v) })
  }
})
const bbox = bboxParam('bbox', defaultBbox)

// Filter parameters
const startTime = timeParam('startTime', new Date(0, 0, 0, 0, 0))
const endTime = timeParam('endTime', new Date(0, 0, 0, 23, 59))
const unitSystem = stringParam('unitSystem', 'us')
const hideUnmarked = booleanParam('hideUnmarked', false)
const dataDisplayMode = stringParam('dataDisplayMode', 'Route')
const colorKey = stringParam('colorKey', 'Mode')
const baseMap = stringParam('baseMap', 'Streets')
const selectedDayOfWeekMode = stringParam('selectedDayOfWeekMode', 'Any')
const selectedTimeOfDayMode = stringParam('selectedTimeOfDayMode', 'All')

// Route type selection with default to all route types
const selectedRouteTypes = computed({
  get (): number[] {
    const param = route.query.selectedRouteTypes?.toString()
    if (param) {
      return param.split(',').map(p => parseInt(p)).filter(Boolean)
    }
    return Array.from(routeTypes.keys())
  },
  set (v: number[]) {
    setQuery({ selectedRouteTypes: v.join(',') })
  }
})

const selectedAgencies = arrayParam('selectedAgencies', [])

// Days selection with special handling
const selectedDays = computed({
  get (): dow[] {
    if (!Object.prototype.hasOwnProperty.call(route.query, 'selectedDays')) {
      // if no `selectedDays` param present, check them all
      return dowValues.slice()
    } else {
      const param = route.query.selectedDays?.toString()
      return param ? param.split(',').filter(Boolean) as dow[] : []
    }
  },
  set (v: dow[]) {
    // if all days are checked, just omit the param
    const days = new Set(v)
    const omit = dowValues.every(day => days.has(day))
    setQuery({ selectedDays: omit ? '' : v.join(',') })
  }
})

// Frequency parameters
const frequencyUnderEnabled = booleanParam('frequencyUnderEnabled', false)
const frequencyUnder = numberParam('frequencyUnder', 15)
const frequencyOverEnabled = booleanParam('frequencyOverEnabled', false)
const frequencyOver = numberParam('frequencyOver', 15)
const calculateFrequencyMode = booleanParam('calculateFrequencyMode', false)

// Fare parameters
const maxFareEnabled = booleanParam('maxFareEnabled', false)
const maxFare = numberParam('maxFare', 0)
const minFareEnabled = booleanParam('minFareEnabled', false)
const minFare = numberParam('minFare', 0)

/////////////////
// Loading and error handling
const loading = ref(false)
const hasError = ref(false)
const error = ref(null)
const stopDepartureProgress = ref({ queue: 0, total: 0 })
const stopDepartureLoadingComplete = ref(false)

function _setError (err: any) {
  error.value = err
  hasError.value = true
}

// Runs on explore event from query (when user clicks "Run Query")
function runQuery () {
  runCount.value++
  activeTab.value = { tab: 'map', sub: '' }
  stopFeatures.value = []
  routeFeatures.value = []
  agencyFeatures.value = []
}

/////////////////
// Computed config and filters

const scenarioConfig = computed((): ScenarioConfig => {
  return {
    bbox: bbox.value,
    scheduleEnabled: scheduleEnabled.value,
    startDate: startDate.value,
    endDate: endDate.value,
    geographyIds: geographyIds.value,
  }
})

const scenarioFilter = computed((): ScenarioFilter => {
  return {
    selectedRouteTypes: selectedRouteTypes.value || [],
    selectedDays: selectedDays.value || [],
    selectedDayOfWeekMode: selectedDayOfWeekMode.value || '',
    selectedAgencies: selectedAgencies.value || [],
    startTime: startTime.value,
    endTime: endTime.value,
    frequencyUnder: (frequencyUnderEnabled.value ? frequencyUnder.value : -1) || -1,
    frequencyOver: (frequencyOverEnabled.value ? frequencyOver.value : -1) || -1,
    selectedTimeOfDayMode: selectedTimeOfDayMode.value || '',
    frequencyUnderEnabled: frequencyUnderEnabled.value || false,
    frequencyOverEnabled: frequencyOverEnabled.value || false,
  }
})

/////////////////
// Geography datasets

// const {
//   result: censusGeographyResult,
// } = useQuery<{ census_datasets: CensusDataset[] }>(
//   geographyLayerQuery,
//   () => ({
//     geography_ids: geographyIds.value,
//     include_geographies: geographyIds.value.length > 0,
//   })
// )

const censusGeographyResult = ref<{ census_datasets: CensusDataset[] } | null>(null)

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

// const censusGeographyLayerOptions = ref<CensusDataset[]>([])
// const censusGeographiesSelected = ref([])

/////////////////

// Each result in the filter summary will be a string to be used as a bullet point.
// We will only include results if the filter is set to something interesting (not default)
const filterSummary = computed((): string[] => {
  const results: string[] = []

  // route types
  const rtypes = selectedRouteTypes.value.map(val => toTitleCase(routeTypes.get(val) || '')).filter(Boolean)
  if (rtypes.length !== routeTypes.size) {
    results.push('with route types ' + rtypes.join(', '))
  }

  // agencies
  const agencies = selectedAgencies.value
  if (agencies.length) {
    results.push('operated by ' + agencies.join(', '))
  }

  // date range
  const today = fmtDate(getLocalDateNoTime(), 'P')
  const sdate = fmtDate(startDate.value, 'P') || today
  const edate = fmtDate(endDate.value, 'P') || today
  if (sdate !== today && edate !== today && sdate !== edate) {
    results.push('operating between ' + sdate + ' and ' + edate)
  } else if (sdate !== today && edate !== today && sdate === edate) {
    results.push('operating on ' + sdate)
  } else if (sdate !== today && edate === today) {
    results.push('operating after ' + sdate)
  }

  // days of week  (always show something here)
  const days = selectedDays.value.map(val => toTitleCase(val))
  const dowMode = selectedDayOfWeekMode.value
  if (dowMode === 'All' /* && days.length !== 7 */) {
    results.push('operating all of ' + days.join(', '))
  } else if (dowMode === 'Any') {
    results.push('operating any of ' + days.join(', '))
  }

  // time range
  if (selectedTimeOfDayMode.value !== 'All') {
    const stime = fmtTime(startTime.value, 'p')
    const etime = fmtTime(endTime.value, 'p')
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
  const hasMinFreq = frequencyOverEnabled.value
  const minFreq = frequencyOver.value
  const hasMaxFreq = frequencyUnderEnabled.value
  const maxFreq = frequencyUnder.value
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

/////////////////////////
// Event passing
/////////////////////////

const stopFeatures = shallowRef<Stop[]>([])
const routeFeatures = shallowRef<Route[]>([])
const agencyFeatures = shallowRef<Agency[]>([])
const exportFeatures = shallowRef<Feature[]>([])

// Tab handling
const activeTab = ref({ tab: 'query', sub: '' })

// Initialize displayEditBboxMode based on initial values
const displayEditBboxMode = ref(activeTab.value.tab === 'query' && (route.query.geomSource?.toString() || 'bbox') === 'bbox')

interface Tab {
  tab: string
  sub: string
}

function setTab (v: Tab) {
  if (activeTab.value.tab === v.tab) {
    activeTab.value = { tab: 'map', sub: '' }
    return
  }
  activeTab.value = v
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
    // Can't directly assign to bbox.value since it's computed
    // Need to trigger the setter by calling setQuery
    setQuery({ bbox: bboxString(mapExtent.value) })
  }
})

watch([activeTab, geomSource], () => {
  if (activeTab.value.tab === 'query' && geomSource.value === 'bbox') {
    displayEditBboxMode.value = true
  } else {
    displayEditBboxMode.value = false
  }
})

async function setMapExtent (v: Bbox) {
  mapExtent.value = v
  if (geomSource.value === 'mapExtent') {
    // Can't directly assign to bbox.value since it's computed
    // Need to trigger the setter by calling setQuery
    setQuery({ bbox: bboxString(mapExtent.value) })
  }
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

//////////////////////
// Data fetching and filtering

watch(() => [scenarioConfig], () => {
  console.log('Running scenario fetcher', scenarioConfig.value)
}, { deep: true })

// Apply filters to routes and stops
watch(() => [
  scenarioConfig,
  scenarioFilter
], () => {
  console.log('Applying scenario filter', scenarioConfig.value, scenarioFilter.value)
  // Check defaults
  // const selectedDateRangeValue = selectedDateRange.value || []
  const filterResult = applyScenarioResultFilter(
    {
      routes: [],
      stops: [],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: true,
    },
    scenarioConfig.value,
    scenarioFilter.value,
  )
  console.log('Filter result', filterResult)
}, { deep: true })

//////////////////////
// Helpers
//////////////////////

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

function toTitleCase (str: string): string {
  return str.replace(
    /\w\S*/g,
    text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
  )
}
</script>

<style scoped lang="scss">
.cal-overlay {
  position:absolute;
  top:0px;
  left:0px;
  height:100vh;
  z-index:1000;
}
</style>
