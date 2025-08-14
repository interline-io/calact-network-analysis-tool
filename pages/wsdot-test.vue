<template>
  <div>
    <tl-title title="WSDOT Report Viewer" />

    <div class="columns">
      <div class="column is-one-quarter">
        <o-field v-for="[levelKey, levelColor] of Object.entries(levelColors)" :key="levelKey" :style="{ backgroundColor: levelColor }">
          <o-checkbox v-model="selectedLevels" :native-value="levelKey">
            {{ levelKey }}: {{ levelCounts[levelKey] }}
          </o-checkbox>
        </o-field>
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
import { parseBbox, bboxString } from '~/src/geom'
import { cannedBboxes } from '~/src/constants'
import type { TableColumn, TableReport } from '~/components/cal/datagrid.vue'
import { parseDate, fmtDate } from '~/src/datetime'

const levelKeys = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'levelNights'] as const
type LevelKey = typeof levelKeys[number]

//////////////

const zoom = 6
const scenarioName = 'WA+OR' //  'Downtown Portland, OR'
const reportFile = `/examples/${scenarioName}.wsdot.json`
const startDate = parseDate('2025-08-11')
const endDate = parseDate('2025-08-18')
const config: WSDOTReportConfig = {
  bbox: parseBbox(cannedBboxes.get(scenarioName) || ''),
  scheduleEnabled: true,
  startDate: startDate!,
  endDate: endDate!,
  geographyIds: [],
  stopLimit: 1000,
  weekdayDate: startDate!,
  weekendDate: endDate!,
}

const bboxCenter = computed(() => {
  const pt = {
    lat: (config.bbox!.ne.lat + config.bbox!.sw.lat) / 2,
    lon: (config.bbox!.ne.lon + config.bbox!.sw.lon) / 2,
  }
  return pt
})

// Fetch report
const data: WSDOTReport = await fetch(reportFile)
  .then(res => res.json())

const selectedLevels = ref<LevelKey[]>(Array.from(levelKeys))

const levelCounts: ComputedRef<Record<string, number>> = computed(() => {
  return levelKeys.reduce((acc, key) => {
    acc[key] = data.stops.filter(stop => stop[key]).length
    return acc
  }, {} as Record<LevelKey, number>)
})

const stopFeatures = computed(() => {
  const features: Feature[] = data.stops.map((stop) => {
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
