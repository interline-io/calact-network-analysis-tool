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
        <div v-if="activeTab.tab === 'query'" class="cal-overlay">
          <cal-query
            v-model:scenario-config="scenarioConfig"
            v-model:scenario-filter="scenarioFilter"
            v-model:ui-config="uiConfig"
            @explore="runQuery()"
            @load-example-data="loadExampleData"
          />
        </div>

        <div v-if="activeTab.tab === 'filter'" class="cal-overlay">
          <!-- <cal-filter
            v-model:scenario-config="scenarioConfig"
            v-model:scenario-filter="scenarioFilter"
            v-model:ui-config="uiConfig"
            :scenario-filter-result="scenarioFilterResult"
            :active-tab="activeTab.sub"
            @reset-filters="resetFilters"
          /> -->
        </div>

        <div v-if="activeTab.tab === 'report'" class="cal-overlay">
          <!-- <cal-report
            v-model:ui-config="uiConfig"
            v-model:scenario-config="scenarioConfig"
            v-model:scenario-filter="scenarioFilter"
            v-model:scenario-filter-result="scenarioFilterResult"
            @click-filter-link="setTab({ tab: 'filter', sub: 'data-display' })"
          /> -->
        </div>

        <div v-if="activeTab.tab === 'analysis'" class="cal-overlay">
          <div style="background:white;width:100%">
            <analysis-picker
              :scenario-data="scenarioData"
              :scenario-config="scenarioConfig"
            />
          </div>
        </div>

        <!-- This is a component for displaying the map and legend -->
        <cal-map
          v-model:ui-config="uiConfig"
          v-model:scenario-config="scenarioConfig"
          v-model:scenario-filter="scenarioFilter"
          v-model:scenario-filter-result="scenarioFilterResult"
        />
      </div>

      <!-- Loading Progress Modal - positioned at the end for highest z-index -->
      <tl-modal
        v-model="showLoadingModal"
        title="Loading Scenario Data"
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

<script lang="ts">
</script>

<script lang="ts" setup>
import { useQuery } from '@vue/apollo-composable'
import { navigateTo } from '#imports'
import { type CensusDataset, type CensusGeography, geographyLayerQuery } from '~/src/census'
import { type Bbox, type Point, parseBbox, bboxString } from '~/src/geom'
import { fmtDate, fmtTime, parseDate, parseTime, getLocalDateNoTime } from '~/src/datetime'
import { type dow, dowValues, routeTypes, cannedBboxes } from '~/src/constants'
import type { ScenarioData, ScenarioFilterResult } from '~/src/scenario/scenario'
import { applyScenarioResultFilter } from '~/src/scenario/scenario'
import { ScenarioStreamReceiver } from '~/src/scenario/scenario-streamer'
import { ScenarioDataReceiver, type ScenarioProgress } from '~/src/scenario/scenario-fetcher'

// User interface configuration values
export interface UIConfig {
  cannedBbox: string
  mapExtentCenter: Point | null
  geomSource: string
  geomLayer: string
  unitSystem: string
  dataDisplayMode: string
  colorKey: string
  baseMap: string
  hideUnmarked: boolean
  censusGeographyLayerOptions: { value: string, label: string }[]
  censusGeographiesSelected: CensusGeography[]
  displayEditBboxMode: boolean
}

definePageMeta({
  layout: false
})

const route = useRoute()

/////////////////
// Loading and error handling
/////////////////

const runCount = ref(0)
const error = ref(null)

// Runs on explore event from query (when user clicks "Run Query")
function runQuery () {
  runCount.value++
  activeTab.value = { tab: 'map', sub: '' }
  fetchScenario('')
}

// Replace the individual computed properties with a single reactive config object
const scenarioConfig = reactive({
  get bbox () {
    const defaultBbox = cannedBboxes.get(uiConfig.cannedBbox)?.bboxString || ''
    const bbox = route.query.bbox?.toString() ?? defaultBbox
    return parseBbox(bbox)
  },
  set bbox (v: Bbox) {
    setQuery({ ...route.query, bbox: bboxString(v) })
  },

  get startDate () {
    return parseDate(route.query.startDate?.toString() || '') || getLocalDateNoTime()
  },
  set startDate (v: Date) {
    setQuery({ ...route.query, startDate: fmtDate(v) })
  },

  get endDate () {
    if (route.query?.endDate) {
      return parseDate(route.query.endDate?.toString() || '') || getLocalDateNoTime()
    }
    const n = new Date(this.startDate.valueOf())
    n.setDate(n.getDate() + 6)
    return n
  },
  set endDate (v: Date) {
    setQuery({ ...route.query, endDate: fmtDate(v) })
  },

  get scheduleEnabled () {
    return true
  },
  set scheduleEnabled (v: boolean) {
    // scheduleEnabled.value = v
  },

  get geographyIds () {
    return route.query.geographyIds?.toString().split(',').map(p => (parseInt(p))) || []
  },
  set geographyIds (v: number[]) {
    setQuery({ ...route.query, geographyIds: v.map(String).join(',') })
  },

  get geomSource () {
    return route.query.geomSource?.toString() || 'bbox'
  },
  set geomSource (v: string) {
    setQuery({ ...route.query, geomSource: v })
  },

  get geomLayer () {
    return route.query.geomLayer ? route.query.geomLayer?.toString() : 'place'
  },
  set geomLayer (v: string) {
    setQuery({ ...route.query, geomLayer: v })
  },

  get stopLimit () {
    return parseInt(route.query.stopLimit?.toString() || '') || 100
  },
  set stopLimit (v: number) {
    setQuery({ ...route.query, stopLimit: v.toString() })
  }
})

const scenarioFilter = reactive({
  get startTime () {
    return parseTime(route.query.startTime?.toString() || '') || parseTime('00:00:00')
  },
  set startTime (v: Date | undefined) {
    setQuery({ ...route.query, startTime: fmtTime(v) })
  },
  get endTime () {
    return parseTime(route.query.endTime?.toString() || '') || parseTime('23:59:00')
  },
  set endTime (v: Date | undefined) {
    setQuery({ ...route.query, endTime: fmtTime(v) })
  },
  get selectedDayOfWeekMode () {
    return route.query.selectedDayOfWeekMode?.toString() || 'Any'
  },
  set selectedDayOfWeekMode (v: string) {
    setQuery({ ...route.query, selectedDayOfWeekMode: v === 'Any' ? '' : v })
  },
  get selectedTimeOfDayMode () {
    return route.query.selectedTimeOfDayMode?.toString() || 'All'
  },
  set selectedTimeOfDayMode (v: string) {
    setQuery({ ...route.query, selectedTimeOfDayMode: v === 'All' ? '' : v })
  },
  get selectedRouteTypes (): number[] {
    const d = arrayParam('selectedRouteTypes', [])
    if (d.length) {
      return d.map(p => parseInt(p))
    }
    return Array.from(routeTypes.keys())
  },
  set selectedRouteTypes (v: string[]) {
    setQuery({ ...route.query, selectedRouteTypes: v.join(',') })
  },
  get selectedAgencies (): string[] {
    return arrayParam('selectedAgencies', [])
  },
  set selectedAgencies (v: string[]) {
    setQuery({ ...route.query, selectedAgencies: v.join(',') })
  },
  get selectedDays (): dow[] {
    if (!Object.prototype.hasOwnProperty.call(route.query, 'selectedDays')) {
      // if no `selectedDays` param present, check them all
      return dowValues.slice()
    } else {
      return arrayParam('selectedDays', []) as dow[]
    }
  },
  set selectedDays (v: string[]) {
    // if all days are checked, just omit the param
    const days = new Set(v)
    const omit = dowValues.every(day => days.has(day))
    setQuery({ ...route.query, selectedDays: omit ? '' : v.join(',') })
  },
  get frequencyUnderEnabled () {
    return route.query.frequencyUnderEnabled?.toString() === 'true'
  },
  set frequencyUnderEnabled (v: boolean) {
    setQuery({ ...route.query, frequencyUnderEnabled: v ? 'true' : '' })
  },
  get frequencyUnder () {
    return parseInt(route.query.frequencyUnder?.toString() || '') || 15
  },
  set frequencyUnder (v: number) {
    setQuery({ ...route.query, frequencyUnder: v.toString() })
  },
  get frequencyOverEnabled () {
    return route.query.frequencyOverEnabled?.toString() === 'true'
  },
  set frequencyOverEnabled (v: boolean) {
    setQuery({ ...route.query, frequencyOverEnabled: v ? 'true' : '' })
  },
  get frequencyOver () {
    return parseInt(route.query.frequencyOver?.toString() || '') || 15
  },
  set frequencyOver (v: number) {
    setQuery({ ...route.query, frequencyOver: v.toString() })
  },
  get calculateFrequencyMode () {
    return route.query.calculateFrequencyMode?.toString() === 'true'
  },
  set calculateFrequencyMode (v: boolean) {
    setQuery({ ...route.query, calculateFrequencyMode: v ? 'true' : '' })
  },
  get maxFareEnabled () {
    return route.query.maxFareEnabled?.toString() === 'true'
  },
  set maxFareEnabled (v: boolean) {
    setQuery({ ...route.query, maxFareEnabled: v ? 'true' : '' })
  },
  get maxFare () {
    return parseInt(route.query.maxFare?.toString() || '') || 0
  },
  set maxFare (v: number) {
    setQuery({ ...route.query, maxFare: v.toString() })
  },
  get  minFareEnabled () {
    return route.query.minFareEnabled?.toString() === 'true'
  },
  set minFareEnabled (v: boolean) {
    setQuery({ ...route.query, minFareEnabled: v ? 'true' : '' })
  },
  get minFare () {
    return parseInt(route.query.minFare?.toString() || '') || 0
  },
  set minFare (v: number) {
    setQuery({ ...route.query, minFare: v.toString() })
  }
})

const uiConfig = reactive({
  get geomSource () {
    return route.query.geomSource?.toString() || 'bbox'
  },
  set geomSource (v: string) {
    setQuery({ ...route.query, geomSource: v })
  },
  get geomLayer () {
    return route.query.geomLayer ? route.query.geomLayer?.toString() : 'place'
  },
  set geomLayer (v: string) {
    setQuery({ ...route.query, geomLayer: v })
  },
  get unitSystem () {
    return route.query.unitSystem?.toString() || 'us'
  },
  set unitSystem (v: string) {
    setQuery({ ...route.query, unitSystem: v })
  },
  get dataDisplayMode () {
    return route.query.dataDisplayMode?.toString() || 'Route'
  },
  set dataDisplayMode (v: string) {
    setQuery({ ...route.query, dataDisplayMode: v })
  },
  get colorKey () {
    return route.query.colorKey?.toString() || 'Mode'
  },
  set colorKey (v: string) {
    setQuery({ ...route.query, colorKey: v })
  },
  get baseMap () {
    return route.query.baseMap?.toString() || 'Streets'
  },
  set baseMap (v: string) {
    setQuery({ ...route.query, baseMap: v })
  },
  get hideUnmarked () {
    return route.query.hideUnmarked?.toString() === 'true'
  },
  set hideUnmarked (v: boolean) {
    setQuery({ ...route.query, hideUnmarked: v ? 'true' : '' })
  },
  get censusGeographyLayerOptions () {
    const geomDatasets = censusGeographyResult.value?.census_datasets || []
    const options = []
    for (const ds of geomDatasets || []) {
      for (const layer of ds.layers || []) {
        const label = `${ds.description || ds.name}: ${layer.description || layer.name}`
        options.push({ value: layer.name, label: label })
      }
    }
    return options
  },
  get censusGeographiesSelected () {
    const ret: CensusGeography[] = []
    for (const ds of censusGeographyResult.value?.census_datasets || []) {
      for (const geo of ds.geographies || []) {
        ret.push(geo)
      }
    }
    return ret
  },
  get cannedBbox () {
    return route.query.cannedBbox?.toString() || 'downtown-portland'
  },
  set cannedBbox (v: string) {
    setQuery({ ...route.query, cannedBbox: v })
  },
  get mapExtentCenter () {
    return { lon: -122, lat: 37 } as Point | null
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
    geography_ids: scenarioConfig.geographyIds,
    include_geographies: scenarioConfig.geographyIds.length > 0,
  })
)

/////////////////////////
// Event passing
/////////////////////////

// Tab handling
const activeTab = ref({ tab: 'query', sub: '' })

watch([activeTab, uiConfig.geomSource], () => {
  if (activeTab.value.tab === 'query' && uiConfig.geomSource === 'bbox') {
    displayEditBboxMode.value = true
  } else {
    displayEditBboxMode.value = false
  }
})

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

////////////////////////////
// Scenario
////////////////////////////

// Internal state for streaming scenario data
const scenarioData = ref<ScenarioData | null>(null)
const scenarioFilterResult = ref<ScenarioFilterResult | undefined>(undefined)

// Loading progress tracking for modal
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)
const showLoadingModal = ref(false)

const loadExampleData = async (exampleName: string) => {
  console.log('loading:', exampleName)
  activeTab.value = { tab: 'map', sub: '' }
  fetchScenario(exampleName)
}

// Scenario fetching logic
const fetchScenario = async (loadExample: string) => {
  console.log('fetchScenario:', loadExample)
  const config = scenarioConfig
  if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    return // Need either bbox or geography IDs, unless loading example
  }
  try {
    showLoadingModal.value = true
    loadingProgress.value = null
    stopDepartureCount.value = 0

    // Create receiver to accumulate scenario data
    const receiver = new ScenarioDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        // Update progress for modal
        loadingProgress.value = progress
        stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0
        console.log(`Stop departures loaded: ${stopDepartureCount.value}`)

        // Apply filters to partial data and emit (without schedule-dependent features)
        // Skip if no route/stop data
        if (progress.partialData?.routes.length === 0 && progress.partialData?.stops.length === 0) {
          return
        }
        scenarioData.value = receiver.getCurrentData()
      },
      onComplete: () => {
        // Get final accumulated data and apply filters
        // showLoadingModal.value = false
        loadingProgress.value = null
        scenarioData.value = receiver.getCurrentData()
      },
      onError: (err: any) => {
        showLoadingModal.value = false
        loadingProgress.value = null
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
        headers: {
          'Content-Type': 'application/json',
        },
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
  } catch (err: any) {
    console.error('Scenario fetch error:', err)
    error.value = err
    showLoadingModal.value = false
    loadingProgress.value = null
  }
}

// Apply filters and emit results when data or filters change
watch(() => [
  scenarioData.value,
  scenarioFilter,
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
// const filterSummary = computed((): string[] => {
//   // const mode = dataDisplayMode.value
//   const results: string[] = []

//   // route types
//   const rtypes = scenarioFilter.value.selectedRouteTypes.map(val => toTitleCase(routeTypes.get(val) || '')).filter(Boolean)
//   if (rtypes.length !== routeTypes.size) {
//     results.push('with route types ' + rtypes.join(', '))
//   }

//   // agencies
//   const agencies = scenarioFilter.value.selectedAgencies
//   if (agencies.length) {
//     results.push('operated by ' + agencies.join(', '))
//   }

//   // date range
//   const today = fmtDate(getLocalDateNoTime(), 'P')
//   const sdate = fmtDate(scenarioConfig.value.startDate, 'P') || today
//   const edate = fmtDate(scenarioConfig.value.endDate, 'P') || today
//   if (sdate !== today && edate !== today && sdate !== edate) {
//     results.push('operating between ' + sdate + ' and ' + edate)
//   } else if (sdate !== today && edate !== today && sdate === edate) {
//     results.push('operating on ' + sdate)
//   } else if (sdate !== today && edate === today) {
//     results.push('operating after ' + sdate)
//   }

//   // days of week  (always show something here)
//   const days = scenarioFilter.value.selectedDays.map(val => toTitleCase(val))
//   const dowMode = scenarioFilter.value.selectedDayOfWeekMode
//   if (dowMode === 'All' /* && days.length !== 7 */) {
//     results.push('operating all of ' + days.join(', '))
//   } else if (dowMode === 'Any') {
//     results.push('operating any of ' + days.join(', '))
//   }

//   // time range
//   if (scenarioFilter.value.selectedTimeOfDayMode !== 'All') {
//     const stime = fmtTime(scenarioFilter.value.startTime, 'p')
//     const etime = fmtTime(scenarioFilter.value.endTime, 'p')
//     if (stime && etime && stime !== etime) {
//       results.push('operating between ' + stime + ' and ' + etime)
//     } else if (stime && etime && stime === etime) {
//       results.push('operating at ' + stime)
//     } else if (stime && !etime) {
//       results.push('operating after ' + stime)
//     } else if (etime && !stime) {
//       results.push('operating before ' + etime)
//     }
//   }

//   // frequencies
//   const hasMinFreq = scenarioFilter.value.frequencyOverEnabled
//   const minFreq = scenarioFilter.value.frequencyOver
//   const hasMaxFreq = scenarioFilter.value.frequencyUnderEnabled
//   const maxFreq = scenarioFilter.value.frequencyUnder
//   if (hasMinFreq && hasMaxFreq && minFreq !== maxFreq) {
//     results.push('with frequency between ' + minFreq + ' and ' + maxFreq + ' minutes')
//   } else if (hasMinFreq && hasMaxFreq && minFreq === maxFreq) {
//     results.push('with frequency exactly ' + minFreq + ' minutes')
//   } else if (hasMinFreq && !hasMaxFreq) {
//     results.push('with frequency at least ' + minFreq + ' minutes')
//   } else if (hasMaxFreq && !hasMinFreq) {
//     results.push('with frequency less than ' + maxFreq + ' minutes')
//   }

//   // fares
//   const hasMinFare = minFareEnabled.value
//   const minDollar = minFare.value
//   const hasMaxFare = maxFareEnabled.value
//   const maxDollar = maxFare.value
//   if (hasMinFare && hasMaxFare && minDollar !== maxDollar) {
//     results.push('with fare between $' + minDollar + ' and $' + maxDollar)
//   } else if (hasMinFare && hasMaxFare && minDollar === maxDollar) {
//     results.push('with fare exactly $' + minDollar)
//   } else if (hasMinFare && !hasMaxFare) {
//     results.push('with fare at least $' + minDollar)
//   } else if (hasMaxFare && !hasMinFare) {
//     results.push('with fare less than $' + maxDollar)
//   }

//   return results
// })

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
.cal-overlay {
  position:absolute;
  top:0px;
  left:0px;
  height:100vh;
  z-index:1000;
}
</style>

<style>
/* Ensure modal is always on top */
.tl-modal {
  z-index: 99999 !important;
}
</style>
