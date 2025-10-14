<template>
  <div>
    <div class="box level">
      <div class="level-item has-text-centered">
        <div>
          <p class="heading">
            Analysis Period: Weekday Date
          </p>
          <p class="title is-6">
            {{ fmtDate(wsdotReportConfig.weekdayDate) }}
          </p>
        </div>
      </div>
      <div class="level-item has-text-centered">
        <div>
          <p class="heading">
            Analysis Period: Weekend Date
          </p>
          <p class="title is-6">
            {{ fmtDate(wsdotReportConfig.weekendDate) }}
          </p>
        </div>
      </div>
      <div v-if="wsdotReportConfig.stopBufferRadius" class="level-item has-text-centered">
        <div>
          <p class="heading">
            Stop Buffer Radius
          </p>
          <p class="title is-6">
            {{ wsdotReportConfig.stopBufferRadius }} meters
          </p>
        </div>
      </div>
    </div>
    <div class="columns">
      <div class="column is-one-half">
        <o-field label="Frequency level selection and stats" class="mt-4" />
        <table class="wsdot-level-details">
          <tbody v-for="[levelKey, levelDetail] of Object.entries(levelDetails)" :key="levelKey">
            <tr>
              <td :class="getFrequencyLevelClass(levelKey)" colspan="5">
                <o-checkbox v-model="selectedLevels" :native-value="levelKey">
                  {{ levelDetail.label }}
                </o-checkbox>
              </td>
            </tr>
            <tr v-for="[adminKey, pop] of Object.entries(levelDetail.layerPops)" :key="adminKey">
              <td style="width:50px" />
              <td>
                {{ adminKey }}
              </td>
              <td>
                {{ pop.stopCount.toLocaleString() }} stops
              </td>
              <td>{{ Math.round(pop.intersectionPopulation).toLocaleString() }} pop</td>
              <td>
                <template v-if="popMethod === 'bboxIntersection'">
                  {{ pop.bboxPopulation > 0 ? ((pop.intersectionPopulation / pop.bboxPopulation) * 100).toFixed(1) : '0' }}%
                </template>
                <template v-else>
                  {{ pop.totalPopulation > 0 ? ((pop.intersectionPopulation / pop.totalPopulation) * 100).toFixed(1) : '0' }}%
                </template>
              </td>
            </tr>
          </tbody>
        </table>

        <o-field class="py-2">
          <cal-csv-download
            :data="populationDatagrid.data"
            button-text="Download Population Data as CSV"
          />
        </o-field>

        <o-field label="Map display options" class="mt-4">
          <o-checkbox v-model="showStopBuffers">
            Show stop buffers
          </o-checkbox>
          <o-dropdown
            v-model:model-value="selectedStates"
            selectable
            multiple
          >
            <template #trigger>
              <o-button
                type="button"
                icon-right="caret-down"
              >
                States ({{ selectedStates.length }})
              </o-button>
            </template>

            <o-dropdown-item
              v-for="state in Object.keys(StatePopulations).sort()"
              :key="state"
              :value="state"
            >
              {{ state }}
            </o-dropdown-item>
          </o-dropdown>
        </o-field>
        <o-field label="Population options">
          <o-radio v-model="popMethod" native-value="state">
            Percent of state population
          </o-radio>
          <o-radio v-model="popMethod" native-value="bboxIntersection">
            Percent of population in bounding box
          </o-radio>
        </o-field>
      </div>
      <div class="column">
        <cal-map-viewer-ts
          :features="displayFeatures"
          :center="bboxCenter"
          :zoom="zoom"
        />
      </div>
    </div>

    <cal-datagrid
      :table-report="stopDatagrid"
    >
      <template #additional-downloads>
        <o-field>
          <cal-geojson-download
            :data="stopFeatures"
            filename="wsdot-frequent-transit-stops"
            button-text="Download as GeoJSON"
          />
        </o-field>
      </template>

      <template #column-highestLevel="{ value }">
        <span
          :class="getFrequencyLevelClass(value)"
          class="tag"
        >
          {{ formatHighestLevel(value) }}
        </span>
      </template>
      <template #column-level1="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-level2="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-level3="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-level4="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-level5="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-level6="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
      <template #column-levelNights="{ value }">
        <o-icon v-if="value == 1" icon="check" />
        <span v-else />
      </template>
    </cal-datagrid>
  </div>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue'
import { fmtDate, type Feature } from '~/src/core'
import {
  SERVICE_LEVELS,
  levelColors,
} from '~/src/analysis/wsdot'
import type {
  WSDOTReport,
  WSDOTReportConfig,
  LevelKey
} from '~/src/analysis/wsdot'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define read-only props
const props = defineProps<{
  config: WSDOTReportConfig
  report: WSDOTReport
}>()

const { config: wsdotReportConfig, report: wsdotReport } = toRefs(props)

const levelKeys = Object.keys(SERVICE_LEVELS) as LevelKey[]
const selectedLevels = ref<LevelKey[]>(Object.keys(SERVICE_LEVELS) as LevelKey[])
const showStopBuffers = ref(false)
const popMethod = ref<'state' | 'bboxIntersection'>('state')

// Helper functions for Highest Level column rendering
const getFrequencyLevelClass = (level: string) => {
  if (level === 'levelNights') return 'frequency-level-nights'
  if (level === 'levelAll') return 'frequency-level-all'
  return `frequency-level-${level.replace('level', '')}`
}

const formatHighestLevel = (level: string) => {
  if (level === 'levelNights') return 'Night'
  if (level === 'levelAll') return 'All'
  return level.replace('level', 'Level ')
}

//////////////

const zoom = 10
const bboxCenter = computed(() => {
  const pt = {
    lat: (wsdotReportConfig.value.bbox!.ne.lat + wsdotReportConfig.value.bbox!.sw.lat) / 2,
    lon: (wsdotReportConfig.value.bbox!.ne.lon + wsdotReportConfig.value.bbox!.sw.lon) / 2,
  }
  return pt
})

interface StatePopulation {
  totalPopulation: number
  bboxPopulation: number
}

const StatePopulations = computed((): Record<string, StatePopulation> => {
  const levelFeatures = wsdotReport.value.levelLayers['levelAll'] || {}
  const statePopulations: Record<string, StatePopulation> = {}
  for (const stateFeature of levelFeatures['state'] || []) {
    const state = stateFeature.properties.name || 'Unknown'
    if (!statePopulations[state]) {
      statePopulations[state] = { totalPopulation: 0, bboxPopulation: 0 }
    }
    statePopulations[state].totalPopulation = stateFeature.properties.total_population || 0
  }
  //
  for (const stateFeature of wsdotReport.value.bboxIntersection || []) {
    const state = stateFeature.properties.adm1_name || 'Unknown'
    if (!statePopulations[state]) {
      statePopulations[state] = { totalPopulation: 0, bboxPopulation: 0 }
    }
    statePopulations[state].bboxPopulation += stateFeature.properties.total_population || 0
  }
  return statePopulations
})

const selectedStatesShadow = ref<string[] | null>(null)
const selectedStates = computed({
  get: () => {
    if (selectedStatesShadow.value !== null) {
      return selectedStatesShadow.value
    }
    return Object.keys(StatePopulations.value).sort()
  },
  set: (val: string[]) => {
    selectedStatesShadow.value = val
  }
})

interface LayerDetail {
  label: string
  color: string
  layerPops: Record<string, { intersectionPopulation: number, totalPopulation: number, bboxPopulation: number, stopCount: number }>
}
const levelDetails: ComputedRef<Record<string, LayerDetail>> = computed(() => {
  // Get state population
  const statePopulations = StatePopulations.value
  const layerAdminKey = 'adm1_name'

  return levelKeys.reduce((acc, levelName) => {
    // GROUP BY STATE
    const levelFeatures = wsdotReport.value.levelLayers[levelName] || {}
    const layerFeatures = levelFeatures['tract']
    const layerPops: Record<string, { intersectionPopulation: number, totalPopulation: number, bboxPopulation: number, stopCount: number }> = {}
    for (const feature of layerFeatures || []) {
      const state = feature.properties[layerAdminKey] || 'Unknown'
      if (!selectedStates.value.includes(state)) {
        continue
      }
      const stopCount = wsdotReport.value.stops.filter(stop => stop[levelName] && stop.stateName === state).length
      const statePop = statePopulations[state] || { total: 0, bboxIntersection: 0 }
      const layerPopState = layerPops[state] || { intersectionPopulation: 0, totalPopulation: 0, bboxPopulation: 0, stopCount: 0 }
      layerPopState.intersectionPopulation += feature.properties.intersection_population || 0
      layerPopState.totalPopulation = statePop?.totalPopulation || 0
      layerPopState.bboxPopulation = statePop?.bboxPopulation || 0
      layerPopState.stopCount = stopCount || 0
      layerPops[state] = layerPopState
    }

    // Save level details
    acc[levelName] = {
      label: SERVICE_LEVELS[levelName].name,
      color: levelColors[levelName],
      layerPops: layerPops,
    }
    return acc
  }, {} as Record<string, LayerDetail>)
})

const stopFeatures = computed(() => {
  const features: Feature[] = wsdotReport.value.stops.map((stop) => {
    const highestLevel = levelKeys.find(key => stop[key]) || 'unknown'
    const props: Record<string, any> = {
      feedOnestopId: stop.feedOnestopId,
      feedVersionSha1: stop.feedVersionSha1,
      stateName: stop.stateName,
      highestLevel,
      stopId: stop.stopId,
      stopName: stop.stopName || ''
    }
    for (const levelKey of levelKeys) {
      props[levelKey] = stop[levelKey] ? 1 : 0
    }
    return {
      id: `stop_${stop.stopId}`,
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'Point',
        coordinates: [stop.stopLon, stop.stopLat]
      }
    }
  }).filter((s) => {
    if (!s.properties.stateName) {
      return false
    }
    if (selectedStates.value != null && !selectedStates.value.includes(s.properties.stateName)) {
      return false
    }
    for (const levelKey of selectedLevels.value) {
      if (s.properties[levelKey] === 1) {
        return true
      }
    }
    return false
  })
  return features
})

const displayFeatures = computed(() => {
  const features: Feature[] = []
  const reverseLevelKeys = [...levelKeys].reverse()
  for (const level of reverseLevelKeys) {
    if (!levelDetails.value[level]) {
      continue
    }
    if (!selectedLevels.value.includes(level)) {
      continue
    }
    const levelStops = stopFeatures.value
      .filter(stop => stop.properties[level] === 1)
      .map((stop) => {
        return {
          ...stop,
          properties: {
            ...stop.properties,
            'marker-color': levelDetails.value[level].color,
            'marker-radius': 3,
          }
        }
      })
    features.push(...levelStops)
  }

  if (showStopBuffers.value) {
    for (const levelName of levelKeys) {
      if (!selectedLevels.value.includes(levelName)) {
        continue
      }
      const layerFeatures = (wsdotReport.value.levelLayers[levelName] || {})['tract']
      for (const feature of layerFeatures || []) {
        features.push({
          id: feature.id,
          type: 'Feature',
          properties: {
            stroke: levelColors[levelName],
          },
          geometry: feature.geometry
        })
      }
    }
  }
  return features
})

const populationDatagrid = computed((): TableReport => {
  const data: {
    level: string
    label: string
    intersectionPopulation: number
    adminKey: string
    totalPopulation: number
    percentPopulation: number
    stopCount: number
  }[] = []
  for (const [levelKey, levelDetail] of Object.entries(levelDetails.value)) {
    for (const [adminKey, pop] of Object.entries(levelDetail.layerPops)) {
      data.push({
        level: levelKey,
        label: levelDetail.label,
        adminKey: adminKey,
        intersectionPopulation: Math.round(pop.intersectionPopulation),
        totalPopulation: Math.round(pop.totalPopulation),
        percentPopulation: pop.totalPopulation > 0 ? (pop.intersectionPopulation / pop.totalPopulation) * 100 : 0,
        stopCount: pop.stopCount
      })
    }
  }

  const columns: TableColumn[] = [
    { key: 'level', label: 'Level', sortable: true },
    { key: 'label', label: 'Level Name', sortable: true },
    { key: 'adminKey', label: 'State', sortable: true },
    { key: 'intersectionPopulation', label: 'Intersection Population', sortable: true },
    { key: 'totalPopulation', label: 'Total Population', sortable: true },
    { key: 'percentPopulation', label: 'Percent Population (%)', sortable: true },
    { key: 'stopCount', label: 'Number of Stops', sortable: true },
  ]

  return {
    data,
    columns
  }
})

const stopDatagrid = computed((): TableReport => {
  const data = stopFeatures.value.map((feature) => {
    return {
      id: feature.id,
      feedOnestopId: feature.properties.feedOnestopId,
      feedVersionSha1: feature.properties.feedVersionSha1,
      stateName: feature.properties.stateName,
      stopId: feature.properties.stopId,
      stopName: feature.properties.stopName,
      highestLevel: feature.properties.highestLevel,
      stopLon: feature.geometry.coordinates[0],
      stopLat: feature.geometry.coordinates[1],
      level1: feature.properties.level1,
      level2: feature.properties.level2,
      level3: feature.properties.level3,
      level4: feature.properties.level4,
      level5: feature.properties.level5,
      level6: feature.properties.level6,
      levelNights: feature.properties.levelNights,
      levelAll: true,
    }
  })
  const columns: TableColumn[] = [
    { key: 'stateName', label: 'State', sortable: true },
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'highestLevel', label: 'Highest Level', sortable: true },
  ]
  for (const levelKey of levelKeys) {
    if (levelKey === 'levelAll') {
      continue // Skip "All" level in datagrid
    }
    columns.push({ key: levelKey, label: SERVICE_LEVELS[levelKey].name, sortable: true })
  }
  return {
    data,
    columns
  }
})
</script>

<style scoped>
.wsdot-level-details {
  width: 100%;
}
.wsdot-level-details th {
  padding: 0px;
}
.wsdot-level-details td {
  padding: 4px;
}

/* Frequency level color classes - extending Bulma's tag component */
.frequency-level-1 {
  background-color: #00ffff !important;
}

.frequency-level-2 {
  background-color: #00ff80 !important;
}

.frequency-level-3 {
  background-color: #80ff00 !important;
}

.frequency-level-4 {
  background-color: #ffff00 !important;
}

.frequency-level-5 {
  background-color: #ff8000 !important;
}

.frequency-level-6 {
  background-color: #ff0000 !important;
}

.frequency-level-nights {
  background-color: #5c5cff !important;
  color: #ffffff !important;
}

.frequency-level-all {
  background-color: #000000 !important;
  color: #ffffff !important;
}
</style>
