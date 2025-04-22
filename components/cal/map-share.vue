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
      <cal-csv-download :data="stopCsvData" button-text="Download stops as CSV" filename="stops " :disabled="!stopDepartureLoadingComplete" />
      <br>
      <cal-csv-download :data="reportData" button-text="Download agencies as CSV" disabled filename="agencies" />
      <span style="font-size:10pt" class="is-pulled-right">(todo)</span>
      <br>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import { useToastNotification } from '#imports'
import { type Stop, stopToStopCsv } from '../stop'
import { type Route, routeToRouteCsv } from '../route'
import { type Feature } from '../geom'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
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

function copyUrlToClipboard () {
  navigator.clipboard.writeText(windowUrl.value)
  useToastNotification().showToast('Copied to clipboard')
}
</script>
