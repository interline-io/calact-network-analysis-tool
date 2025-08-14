<template>
  <div>
    <tl-title title="WSDOT Frequent Transit Service Study" />

    <div class="columns">
      <div class="column is-one-quarter">
        <table class="wsdot-level-details">
          <tbody v-for="[levelKey, levelDetail] of Object.entries(levelDetails)" :key="levelKey">
            <tr>
              <td :style="{ backgroundColor: levelDetail.color }" colspan="5">
                <o-checkbox v-model="selectedLevels" :native-value="levelKey">
                  Frequency Level: {{ levelKey }}
                </o-checkbox>
              </td>
            </tr>
            <tr v-for="[adminKey, pop] of Object.entries(levelDetail.layerPops)" :key="adminKey">
              <td style="width:50px" />
              <td>{{ adminKey }}</td>
              <td>{{ Math.round(pop).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="column">
        <cal-map-viewer-ts
          :features="stopFeatures"
          :center="bboxCenter"
          :zoom="zoom"
        />
      </div>
    </div>

    <tl-msg-info>
      <div>
        Report bbox: {{ bboxString(config.bbox!) }}
      </div>
      <div>
        Weekday: {{ fmtDate(config.weekdayDate) }}
      </div>
      <div>
        Weekend: {{ fmtDate(config.weekendDate) }}
      </div>
    </tl-msg-info>

    <cal-datagrid
      :table-report="stopDatagrid"
    />
  </div>
</template>

<script lang="ts" setup>
import type { ComputedRef } from 'vue'
import type { WSDOTReport, WSDOTReportConfig } from '~/src/reports/wsdot'
import { levelColors } from '~/src/reports/wsdot'
import type { Feature } from '~/src/geom'
import { bboxString } from '~/src/geom'
import { fmtDate } from '~/src/datetime'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'

const levelKeys = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'levelNights'] as const
type LevelKey = typeof levelKeys[number]

//////////////

const zoom = 13
const scenarioName = 'Downtown Portland, OR'
const reportFile = `/examples/${scenarioName}.wsdot.json`

// Fetch report
const data: { config: WSDOTReportConfig, report: WSDOTReport } = await fetch(reportFile)
  .then(res => res.json())

const { config, report } = data

const bboxCenter = computed(() => {
  const pt = {
    lat: (config.bbox!.ne.lat + config.bbox!.sw.lat) / 2,
    lon: (config.bbox!.ne.lon + config.bbox!.sw.lon) / 2,
  }
  return pt
})

const selectedLevels = ref<LevelKey[]>(Array.from(levelKeys))

interface LayerDetail {
  color: string
  count: number
  layerPops: Record<string, number>
}
const levelDetails: ComputedRef<Record<string, LayerDetail>> = computed(() => {
  return levelKeys.reduce((acc, levelName) => {
    // GROUP BY STATE
    const layerFeatures = (report.levelLayers[levelName] || {})['tract']
    const layerAdminKey = 'adm1_name'
    const layerPops: Record<string, number> = {}
    const layerAdminGroups: Record<string, Feature[]> = {}
    for (const feature of layerFeatures || []) {
      const state = feature.properties[layerAdminKey] || 'Unknown'
      if (!layerAdminGroups[state]) {
        layerAdminGroups[state] = []
      }
      layerAdminGroups[state].push(feature)
      const pop = feature.properties.intersection_population || 0
      layerPops[state] = (layerPops[state] || 0) + pop
    }
    console.log('level:', levelName, 'layerAdminGroups:', layerAdminGroups, 'layerPops:', layerPops)

    // Save level details
    const stopCount = report.stops.filter(stop => stop[levelName]).length
    acc[levelName] = {
      color: levelColors[levelName],
      layerPops: layerPops,
      count: stopCount
    }
    return acc
  }, {} as Record<string, LayerDetail>)
})

const stopFeatures = computed(() => {
  const features: Feature[] = report.stops.map((stop) => {
    const highestLevel = levelKeys.find(key => (stop as Record<LevelKey, boolean>)[key]) || 'levelNights'
    const highestLevelColor = levelColors[highestLevel]
    return {
      id: `stop_${stop.stopId}`,
      type: 'Feature',
      properties: {
        highestLevel,
        'stopId': stop.stopId,
        'stopName': stop.stopName || '',
        'level6': stop.level6,
        'level5': stop.level5,
        'level4': stop.level4,
        'level3': stop.level3,
        'level2': stop.level2,
        'level1': stop.level1,
        'levelNights': stop.levelNights,
        'marker-color': highestLevelColor,
        'marker-radius': 3,
      },
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
    }
  })
  const columns: TableColumn[] = [
    { key: 'stopId', label: 'Stop ID', sortable: true },
    { key: 'stopName', label: 'Stop Name', sortable: true },
    { key: 'highestLevel', label: 'Highest Level', sortable: true },
    { key: 'level1', label: 'Level 1', sortable: true },
    { key: 'level2', label: 'Level 2', sortable: true },
    { key: 'level3', label: 'Level 3', sortable: true },
    { key: 'level4', label: 'Level 4', sortable: true },
    { key: 'level5', label: 'Level 5', sortable: true },
    { key: 'level6', label: 'Level 6', sortable: true },
    { key: 'levelNights', label: 'Level Nights', sortable: true },
  ]
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
