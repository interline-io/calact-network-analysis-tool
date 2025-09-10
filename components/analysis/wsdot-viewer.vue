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
      <div class="column is-one-quarter">
        <o-field label="Frequency level selection and stats" class="mt-4" />
        <table class="wsdot-level-details">
          <tbody v-for="[levelKey, levelDetail] of Object.entries(levelDetails)" :key="levelKey">
            <tr>
              <td :class="getFrequencyLevelClass(levelKey)" colspan="5">
                <o-checkbox v-model="selectedLevels" :native-value="levelKey">
                  Frequency: {{ levelDetail.label }}
                </o-checkbox>
              </td>
            </tr>
            <tr v-for="[adminKey, pop] of Object.entries(levelDetail.layerPops)" :key="adminKey">
              <td style="width:50px" />
              <td v-if="Object.keys(levelDetail.layerPops).length > 1">
                {{ adminKey }}
              </td>
              <td>{{ Math.round(pop.intersection).toLocaleString() }}</td>
              <td>({{ Math.round((pop.intersection / pop.total) * 100) }}% of total population)</td>
            </tr>
          </tbody>
        </table>
        <o-field label="Map display options" class="mt-4">
          <o-checkbox v-model="showStopBuffers">
            Show stop buffers
          </o-checkbox>
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

// Define models for props
const wsdotReportConfig = defineModel<WSDOTReportConfig>('config', { required: true })
const wsdotReport = defineModel<WSDOTReport>('report', { required: true })

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

interface LayerDetail {
  label: string
  color: string
  count: number
  layerPops: Record<string, { intersection: number, total: number }>
}
const levelDetails: ComputedRef<Record<string, LayerDetail>> = computed(() => {
  return levelKeys.reduce((acc, levelName) => {
    const levelFeatures = wsdotReport.value.levelLayers[levelName] || {}

    // Get state population
    const statePopulations: Record<string, number> = {}
    if (popMethod.value == 'bboxIntersection') {
      for (const stateFeature of wsdotReport.value.bboxIntersection || []) {
        const state = stateFeature.properties.adm1_name || 'Unknown'
        if (!statePopulations[state]) {
          statePopulations[state] = 0
        }
        statePopulations[state] += stateFeature.properties.total_population || 0
      }
    } else if (popMethod.value) {
      for (const stateFeature of levelFeatures['state'] || []) {
        const state = stateFeature.properties.name || 'Unknown'
        if (!statePopulations[state]) {
          statePopulations[state] = stateFeature.properties.total_population || 0
        }
      }
    } else {
      console.warn('No population method selected')
    }
    console.log('statePopulations:', statePopulations)

    // GROUP BY STATE
    const layerFeatures = levelFeatures['tract']
    const layerAdminKey = 'adm1_name'
    const layerPops: Record<string, { intersection: number, total: number }> = {}
    const layerAdminGroups: Record<string, Feature[]> = {}
    for (const feature of layerFeatures || []) {
      const state = feature.properties[layerAdminKey] || 'Unknown'
      if (!layerAdminGroups[state]) {
        layerAdminGroups[state] = []
      }
      layerAdminGroups[state].push(feature)
      const pop = feature.properties.intersection_population || 0
      const layerPopState = layerPops[state] || { intersection: 0, total: 0 }
      layerPopState.intersection += pop
      layerPopState.total = statePopulations[state] || 0
      layerPops[state] = layerPopState
    }
    // console.log('level:', levelName, 'layerAdminGroups:', layerAdminGroups, 'layerPops:', layerPops)

    // Save level details
    const stopCount = wsdotReport.value.stops.filter(stop => stop[levelName]).length
    acc[levelName] = {
      label: SERVICE_LEVELS[levelName].name,
      color: levelColors[levelName],
      layerPops: layerPops,
      count: stopCount
    }
    return acc
  }, {} as Record<string, LayerDetail>)
})

const stopFeatures = computed(() => {
  console.log('levelKeys:', levelKeys)
  const features: Feature[] = wsdotReport.value.stops.map((stop) => {
    const highestLevel = levelKeys.find(key => stop[key]) || 'unknown'
    const props: Record<string, any> = {
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
    let found = false
    for (const levelKey of selectedLevels.value) {
      if (s.properties[levelKey] === 1) {
        found = true
        break
      }
    }
    return found
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
    console.log('levelKeys:', levelKeys)
    console.log('selectedLevels:', selectedLevels.value)
    for (const levelName of levelKeys) {
      if (!selectedLevels.value.includes(levelName)) {
        continue
      }
      const layerFeatures = (wsdotReport.value.levelLayers[levelName] || {})['tract']
      console.log(wsdotReport.value.levelLayers[levelName])
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

const stopDatagrid = computed((): TableReport => {
  const data = stopFeatures.value.map((feature) => {
    return {
      id: feature.id,
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
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'highestLevel', label: 'Highest Level', sortable: true },
  ]
  for (const levelKey of levelKeys) {
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
  background-color: #ff00ff !important;
  color: #ffffff !important;
}
</style>
