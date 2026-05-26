<template>
  <article class="message is-dark">
    <div class="message-header">
      Share
    </div>
    <div class="message-body">
      <cat-button @click="copyUrlToClipboard">
        Copy URL to Clipboard
      </cat-button>
      <br><br>
      <cal-geojson-download :data="exportFeatures" />
      <br>
      <cal-csv-download :data="routeCsvData" button-text="Download routes as CSV" filename="routes" />
      <br>
      <cal-csv-download :data="stopCsvData" button-text="Download stops as CSV" filename="stops" />
      <br>
      <cal-csv-download :data="agencyCsvData" button-text="Download agencies as CSV" filename="agencies" />
      <br>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useToastNotification } from '#imports'
import { stopToStopCsv, routeToRouteCsv, agencyToAgencyCsv } from '~~/src/tl'
import type { CensusGeography } from '~~/src/tl'
import type { Feature } from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'

const props = defineProps<{
  scenarioFilterResult?: ScenarioFilterResult
  censusGeographiesSelected: CensusGeography[]
}>()

const exportFeatures = ref<Feature[]>([])

const windowUrl = computed(() => {
  return window.location.href
})

const routeCsvData = computed(() => {
  const routeBufferTracts = props.scenarioFilterResult?.routeBufferTracts
  return props.scenarioFilterResult?.routes
    .filter(s => s.marked)
    .map(r => routeToRouteCsv(r, routeBufferTracts?.get(r.id)))
})

const stopCsvData = computed(() => {
  const stopBufferTracts = props.scenarioFilterResult?.stopBufferTracts
  return props.scenarioFilterResult?.stops
    .filter(s => s.marked)
    .map(s => stopToStopCsv(s, stopBufferTracts?.get(s.id)))
})

const agencyCsvData = computed(() => {
  const agencyBufferTracts = props.scenarioFilterResult?.agencyBufferTracts
  return props.scenarioFilterResult?.agencies
    .filter(s => s.marked)
    .map(a => agencyToAgencyCsv(a, agencyBufferTracts?.get(a.id)))
})

function copyUrlToClipboard () {
  navigator.clipboard.writeText(windowUrl.value)
  useToastNotification().showToast('Copied to clipboard')
}
</script>
