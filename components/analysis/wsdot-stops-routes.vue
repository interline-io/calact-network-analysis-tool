<template>
  <div class="cal-report">
    <tl-title title="WSDOT Transit Stops and Routes" />

    <tl-msg-info>
      <h5 class="title is-5">
        About this Analysis
      </h5>
      <p class="mb-3">
        This analysis exports transit stops and routes data with unique agency identifiers, suitable for GIS analysis and statewide transit planning.
        The data can be downloaded in CSV, GeoJSON, or OGC GeoPackage formats.
      </p>
      <p>
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please cancel to go back to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
      </p>
    </tl-msg-info>

    <tl-msg-error v-if="error" class="mt-4" style="width:400px" :title="error.message">
      An error occurred while running the WSDOT analysis.
    </tl-msg-error>
    <div v-else-if="loading">
      Loading...
    </div>
    <div v-else-if="wsdotReport && wsdotStopsRoutesReport">
      <analysis-wsdot-stops-routes-viewer
        v-model:report="wsdotStopsRoutesReport"
      />
    </div>
    <div v-else>
      <div class="card">
        <header class="card-header">
          <p class="card-header-title">
            Configure Report
          </p>
        </header>
        <div class="card-content">
          <o-field>
            <template #label>
              <o-tooltip multiline label="The weekday date is used to analyze transit service. This determines which specific Monday-Friday schedule is used.">
                Weekday date
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </o-field>

          <o-field>
            <template #label>
              <o-tooltip multiline label="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used.">
                Weekend date
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </o-field>
        </div>
        <footer class="card-footer">
          <div class="field is-grouped is-grouped-right" style="width: 100%; padding: 0.75rem;">
            <div class="control">
              <o-button variant="outlined" @click="handleCancel">
                Cancel
              </o-button>
            </div>
            <div class="control">
              <o-button variant="primary" @click="runQuery">
                Run Report
              </o-button>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- Loading Progress Modal -->
    <tl-modal
      v-model="showLoadingModal"
      title="Loading"
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
  </div>
</template>

<script lang="ts" setup>
import { useApiFetch } from '~/composables/useApiFetch'
import type { WSDOTReport, WSDOTReportConfig } from '~/src/reports/wsdot'
import type { WSDOTStopsRoutesReport } from '~/src/reports/wsdot-stops-routes'
import { type ScenarioData, type ScenarioConfig, ScenarioDataReceiver, ScenarioStreamReceiver, type ScenarioProgress } from '~/src/scenario'

const error = ref<Error | null>(null)
const loading = ref(false)
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotReport = ref<WSDOTReport | null>(null)
const wsdotStopsRoutesReport = ref<WSDOTStopsRoutesReport | null>(null)
const wsdotReportConfig = ref<WSDOTReportConfig>({
  weekdayDate: scenarioConfig.value!.startDate!,
  weekendDate: scenarioConfig.value!.endDate!,
  scheduleEnabled: true,
  stopBufferRadius: 800,
  ...scenarioConfig.value
})

const emit = defineEmits<{
  cancel: []
}>()

const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)

const handleCancel = () => {
  emit('cancel')
}

// Scenario fetching logic - reuse WSDOT report logic but extract stops/routes data
const runQuery = async () => {
  showLoadingModal.value = true
  try {
    await fetchScenario('')
    useToastNotification().showToast('Analysis completed successfully!')
  } catch (err: any) {
    error.value = err
    loadingProgress.value = null
    useToastNotification().showToast('Analysis failed to load: ' + err.message)
  }
  showLoadingModal.value = false
}

const fetchScenario = async (loadExample: string) => {
  console.log('fetchScenario:', loadExample)
  const config = scenarioConfig.value!
  if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    return // Need either bbox or geography IDs, unless loading example
  }
  loadingProgress.value = null
  stopDepartureCount.value = 0

  // Create receiver to accumulate scenario data
  const receiver = new ScenarioDataReceiver({
    onProgress: (progress: ScenarioProgress) => {
      loadingProgress.value = progress
      stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0
      if (progress.partialData?.routes.length === 0 && progress.partialData?.stops.length === 0) {
        return
      }
      scenarioData.value = receiver.getCurrentData()
      if (progress.extraData) {
        console.log('extraData?', progress.extraData)
        wsdotReport.value = progress.extraData as WSDOTReport

        // Convert WSDOT report to stops/routes format for the viewer
        const currentData = receiver.getCurrentData()
        if (currentData) {
          wsdotStopsRoutesReport.value = {
            stops: currentData.stops.map((stop) => {
              const agencyId = stop.route_stops?.[0]?.route?.agency?.agency_id || 'unknown'
              const feedOnestopId = stop.feed_version?.feed?.onestop_id || 'unknown'
              const feedVersionSha1 = stop.feed_version?.sha1 || 'unknown'
              return {
                stopId: stop.stop_id,
                stopName: stop.stop_name || '',
                stopLat: stop.geometry?.coordinates[1] || 0,
                stopLon: stop.geometry?.coordinates[0] || 0,
                agencyId: `${feedOnestopId}:${agencyId}`,
                feedOnestopId,
                feedVersionSha1,
                geometry: stop.geometry || { type: 'Point', coordinates: [0, 0] }
              }
            }),
            routes: currentData.routes.map((route) => {
              const agencyId = route.agency?.agency_id || 'unknown'
              const feedOnestopId = route.feed_version?.feed?.onestop_id || 'unknown'
              const feedVersionSha1 = route.feed_version?.sha1 || 'unknown'
              return {
                routeId: route.route_id,
                routeShortName: route.route_short_name || '',
                routeLongName: route.route_long_name || '',
                routeType: route.route_type,
                agencyId: `${feedOnestopId}:${agencyId}`,
                feedOnestopId,
                feedVersionSha1,
                geometry: route.geometry || { type: 'MultiLineString', coordinates: [] }
              }
            }),
            agencies: [] // Agencies will be computed by the viewer from stops and routes
          }
        }
      }
    },
    onComplete: () => {
      loadingProgress.value = null
      scenarioData.value = receiver.getCurrentData()
    },
    onError: (err: any) => {
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
    const apiFetch = await useApiFetch()
    response = await apiFetch('/api/wsdot', {
      method: 'POST',
      body: JSON.stringify({ config: wsdotReportConfig.value })
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
}
</script>

<style scoped lang="scss">
.cal-report {
  display:flex;
  flex-direction:column;
  background: var(--bulma-scheme-main);
  height: 100vw;
  width: calc(100vw - 100px);
  padding-left:20px;
  padding-right:20px;
}
</style>
