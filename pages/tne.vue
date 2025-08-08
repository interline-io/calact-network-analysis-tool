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

      <!-- This is a component for handling data flow -->
      <cal-scenario
        :bbox="bbox"
        :end-date="endDate"
        :end-time="endTime"
        :frequency-over-enabled="frequencyOverEnabled"
        :frequency-over="frequencyOver"
        :frequency-under-enabled="frequencyUnderEnabled"
        :frequency-under="frequencyUnder"
        :geography-ids="geographyIds"
        :geom-source="geomSource"
        :run-count="runCount"
        :schedule-enabled="scheduleEnabled"
        :selected-agencies="selectedAgencies"
        :selected-day-of-week-mode="selectedDayOfWeekMode"
        :selected-days="selectedDays"
        :selected-route-types="selectedRouteTypes"
        :selected-time-of-day-mode="selectedTimeOfDayMode"
        :start-date="startDate"
        :start-time="startTime"
        @set-stop-departure-progress="stopDepartureProgress = $event"
        @set-stop-departure-loading-complete="stopDepartureLoadingComplete = $event"
        @set-stop-features="stopFeatures = $event"
        @set-agency-features="agencyFeatures = $event"
        @set-route-features="routeFeatures = $event"
        @set-loading="loading = $event"
        @set-error="setError"
      />

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
import { useQuery } from '@vue/apollo-composable'
import { type CensusDataset, type CensusGeography, geographyLayerQuery } from '../components/census'
import { type Bbox, type Point, type Feature, parseBbox, bboxString } from '../components/geom'
import { fmtDate, fmtTime, parseDate, parseTime, getLocalDateNoTime } from '../components/datetime'
import type { Stop } from '../components/stop'
import type { Route } from '../components/route'
import type { Agency } from '../components/agency'
import { type dow, dowValues, routeTypes } from '../components/constants'
import { navigateTo } from '#imports'

definePageMeta({
  layout: false
})

const route = useRoute()

/////////////////

const scheduleEnabled = ref(true)
const defaultBbox = '-122.69075,45.51358,-122.66809,45.53306'
const runCount = ref(0)

/////////////////
// Loading and error handling
const loading = ref(false)
const hasError = ref(false)
const error = ref(null)
const stopDepartureProgress = ref({ queue: 0, total: 0 })
const stopDepartureLoadingComplete = ref(false)

function setError (err: any) {
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

// Handle query parameters
async function setQuery (params: Record<string, any>) {
  await navigateTo({ replace: true, query: removeEmpty({ ...route.query, ...params }) })
}

const geomSource = computed({
  get () {
    return route.query.geomSource?.toString() || 'bbox'
  },
  set (v: string) {
    setQuery({ ...route.query, geomSource: v })
  }
})

const geomLayer = computed({
  get () {
    return route.query.geomLayer ? route.query.geomLayer?.toString() : 'place'
  },
  set (v: string) {
    setQuery({ ...route.query, geomLayer: v })
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
    return parseDate(route.query.startDate?.toString() || '') || getLocalDateNoTime()
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
    return parseTime(route.query.startTime?.toString() || '') || new Date(0, 0, 0, 0, 0)
  },
  set (v: Date | null) {
    setQuery({ ...route.query, startTime: fmtTime(v) })
  }
})

const endTime = computed({
  get () {
    return parseTime(route.query.endTime?.toString() || '') || new Date(0, 0, 0, 23, 59)
  },
  set (v: Date | null) {
    setQuery({ ...route.query, endTime: fmtTime(v) })
  }
})

const bbox = computed({
  get () {
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
    if (!route.query.hasOwnProperty('selectedDays')) {
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

/////////////////

// Each result in the filter summary will be a string to be used as a bullet point.
// We will only include results if the filter is set to something interesting (not default)
const filterSummary = computed((): string[] => {
  const mode = dataDisplayMode.value
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
    bbox.value = mapExtent.value
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
    bbox.value = mapExtent.value
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
.cal-overlay {
  position:absolute;
  top:0px;
  left:0px;
  height:100vh;
  z-index:1000;
}
</style>
