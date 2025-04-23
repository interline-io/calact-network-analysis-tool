<template>
  <article class="message is-dark">
    <div class="message-header">
      Share
    </div>
    <div class="message-body">
      <o-button @click="copyUrlToClipboard">
        Copy URL to Clipboard
      </o-button>
      <br><br>
      <tl-geojson-downloader :features="displayFeatures" label="Download as GeoJSON" filename="export" :disabled="!stopDepartureLoadingComplete" />
      <br><br>
      <cal-csv-download :data="routeCsvData" button-text="Download routes as CSV" filename="routes" :disabled="!stopDepartureLoadingComplete" />
      <br>
      <cal-csv-download :data="stopCsvData" button-text="Download stops as CSV" filename="stops" :disabled="!stopDepartureLoadingComplete" />
      <br>
      <cal-csv-download :data="agencyCsvData" button-text="Download agencies as CSV" filename="agencies" :disabled="!stopDepartureLoadingComplete" />
      <br>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import { useToastNotification } from '#imports'
import { type Stop, stopToStopCsv } from '../stop'
import { type Route, routeToRouteCsv } from '../route'
import { type Agency, agencyToAgencyCsv } from '../agency'
import { type Feature } from '../geom'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
  agencyFeatures: Agency[]
  displayFeatures: Feature[]
  stopDepartureLoadingComplete: boolean
}>()

const route = useRoute()

const windowUrl = computed(() => {
  return window.location.href
})

const reportData = ref([])

const routeCsvData = computed(() => {
  return props.routeFeatures.filter(s => (s.marked)).map(routeToRouteCsv)
})

const stopCsvData = computed(() => {
  return props.stopFeatures.filter(s => s.marked).map(stopToStopCsv)
})

const agencyCsvData = computed(() => {
  return props.agencyFeatures.filter(s => s.marked).map(agencyToAgencyCsv)
})

function copyUrlToClipboard () {
  navigator.clipboard.writeText(windowUrl.value)
  useToastNotification().showToast('Copied to clipboard')
}
</script>
