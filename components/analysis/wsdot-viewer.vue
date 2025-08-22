<template>
  <div>
    <div class="columns">
      <div class="column is-one-quarter">
        <table class="wsdot-level-details">
          <tbody v-for="[levelKey, levelDetail] of Object.entries(levelDetails)" :key="levelKey">
            <tr>
              <td :style="{ backgroundColor: levelDetail.color }" colspan="5">
                <o-checkbox v-model="selectedLevels" :native-value="levelKey">
                  Frequency: {{ levelDetail.label }}
                </o-checkbox>
              </td>
            </tr>
            <tr v-for="[adminKey, pop] of Object.entries(levelDetail.layerPops)" :key="adminKey">
              <td style="width:50px" />
              <td>{{ adminKey }}</td>
              <td>{{ Math.round(pop.intersection).toLocaleString() }}</td>
              <td>({{ Math.round((pop.intersection / pop.total) * 100) }}%)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="column">
        <cal-map-viewer-ts
          :features="displayFeatures"
          :center="bboxCenter"
          :zoom="zoom"
        />
        <br>
        <o-field label="Display options" style="width:300px">
          <o-checkbox v-model="showStopBuffers">
            Show stop buffers
          </o-checkbox>
        </o-field>
      </div>
    </div>

    <tl-msg-info>
      <div>
        Report bbox: {{ bboxString(wsdotReportConfig.bbox!) }}
      </div>
      <div>
        Weekday: {{ fmtDate(wsdotReportConfig.weekdayDate) }}
      </div>
      <div>
        Weekend: {{ fmtDate(wsdotReportConfig.weekendDate) }}
      </div>
    </tl-msg-info>

    <cal-datagrid
      :table-report="stopDatagrid"
    />
  </div>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue'
import type { WSDOTReport, WSDOTReportConfig, LevelKey } from '~/src/reports/wsdot'
import { SERVICE_LEVELS, levelColors } from '~/src/reports/wsdot'
import type { Feature } from '~/src/geom'
import { bboxString } from '~/src/geom'
import { fmtDate } from '~/src/datetime'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

// Define models for props
const wsdotReportConfig = defineModel<WSDOTReportConfig>('config', { required: true })
const wsdotReport = defineModel<WSDOTReport>('report', { required: true })

const levelKeys = Object.keys(SERVICE_LEVELS) as LevelKey[]
const selectedLevels = ref<LevelKey[]>(Object.keys(SERVICE_LEVELS) as LevelKey[])
const showStopBuffers = ref(false)

// TEMPORARY
const StatePopulations: Record<string, number> = {
  Washington: 7693612, // 2020 Census
  Oregon: 4237256, // 2020 Census
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
    // GROUP BY STATE
    const layerFeatures = (wsdotReport.value.levelLayers[levelName] || {})['tract']
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
      layerPopState.total = StatePopulations[state] || 0
      layerPops[state] = layerPopState
    }
    console.log('level:', levelName, 'layerAdminGroups:', layerAdminGroups, 'layerPops:', layerPops)

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

const displayStopFeatures = computed(() => {
  const features: Feature[] = wsdotReport.value.stops.map((stop) => {
    const highestLevel = levelKeys.find(key => stop[key]) || 'levelNights'
    const highestLevelColor = levelColors[highestLevel]
    const props: Record<string, any> = {
      highestLevel,
      'stopId': stop.stopId,
      'stopName': stop.stopName || '',
      'levelNights': stop.levelNights,
      'marker-color': highestLevelColor,
      'marker-radius': 3,
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
  }).filter((stop) => {
    const highestLevel = stop.properties.highestLevel
    return selectedLevels.value.includes(highestLevel)
  })
  return features
})

const displayFeatures = computed(() => {
  const features: Feature[] = [...displayStopFeatures.value]
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

const stopDatagrid = computed((): TableReport => {
  const data = displayStopFeatures.value.map((feature) => {
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
</style>
