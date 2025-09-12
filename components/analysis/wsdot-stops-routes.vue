<template>
  <div>
    <tl-title title="WSDOT Transit Stops and Routes" />

    <tl-msg-info
      collapsible
      :collapsed="hasResults"
      title="About this Analysis"
    >
      <p class="mb-3">
        This analysis exports comprehensive transit stops and routes data with complete GTFS fields and unique agency identifiers, designed for GIS analysis, statewide transit planning, and network connectivity studies. The export includes all standard GTFS stop properties (location, accessibility, platform codes) and route properties (type, colors, descriptions), along with WSDOT service level classifications and feed provenance information.
      </p>
      <p class="mb-3">
        <strong>Key Features:</strong>
      </p>
      <ul class="mb-3">
        <li><strong>Complete GTFS Compliance:</strong> All standard GTFS stop and route fields are included for maximum compatibility with transit planning tools</li>
        <li><strong>Service Level Integration:</strong> WSDOT frequency analysis results are embedded as additional columns (Level 1-6, Night service)</li>
        <li><strong>Data Provenance:</strong> Feed Onestop IDs and version SHA1 hashes ensure data traceability and version control, with links to Transitland's historical feed archive</li>
        <li><strong>Agency Consolidation:</strong> Handles multiple feeds with consistent agency identification across the region</li>
        <li><strong>Network Filtering:</strong> Only includes stops that are connected to active transit routes</li>
      </ul>
      <p class="mb-3">
        The data can be downloaded in CSV format (for spreadsheet analysis) or GeoJSON format (for GIS mapping and spatial analysis). All downloads include the same comprehensive field set, with geographic coordinates preserved for spatial operations.
      </p>
      <p>
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please cancel to go back to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
      </p>
    </tl-msg-info>

    <tl-msg-error v-if="error" class="mt-4" style="width:400px" :title="error.message">
      An error occurred while running the WSDOT analysis.
    </tl-msg-error>
    <div v-else-if="loading" class="has-text-centered">
      <o-loading :active="true" :full-page="false" />
      <p class="mt-4">
        Running WSDOT Transit Stops and Routes Analysis...
      </p>
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
import type {
  WSDOTReport,
  WSDOTReportConfig
} from '~/src/analysis/wsdot'
import {
  processWsdotStopsRoutesReport,
} from '~/src/analysis/wsdot-stops-routes'
import type {
  WSDOTStopsRoutesReport,
} from '~/src/analysis/wsdot-stops-routes'
import {
  ScenarioDataReceiver,
  ScenarioStreamReceiver,
} from '~/src/scenario'
import type {
  ScenarioData,
  ScenarioConfig,
  ScenarioProgress,
} from '~/src/scenario'

const error = ref<Error | null>(null)
const loading = ref(false)
const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotReport = ref<WSDOTReport | null>(null)
const wsdotStopsRoutesReport = ref<WSDOTStopsRoutesReport | null>(null)
const wsdotReportConfig = ref<WSDOTReportConfig>({
  weekdayDate: scenarioConfig.value!.startDate!,
  weekendDate: scenarioConfig.value!.endDate!,
  scheduleEnabled: true,
  stopBufferRadius: 0, // no population data needed for this analysis
  ...scenarioConfig.value
})

const emit = defineEmits<{
  cancel: []
}>()

// Track if results are loaded, to collapse the about message, also for navigation guard
const { setHasResults } = useAnalysisResults()
const hasResults = computed(() => {
  const hasResultsValue = wsdotStopsRoutesReport.value !== null
  setHasResults('wsdot-stops-routes', hasResultsValue)
  return hasResultsValue
})

const handleCancel = () => {
  emit('cancel')
}

// Expose hasResults to parent component
defineExpose({
  hasResults
})

// Runs on explore event from query (when user clicks "Run Query")
const runQuery = async () => {
  showLoadingModal.value = true
  try {
    await fetchScenario('')
  } catch (err: any) {
    error.value = err
  }
  if (!error.value) {
    useToastNotification().showToast('WSDOT stops and routes analysis completed successfully!')
    showLoadingModal.value = false
  }
  loadingProgress.value = null
}

// Based on components/analysis/wsdot.vue fetchScenario
const fetchScenario = async (loadExample: string) => {
  const config = scenarioConfig.value!
  if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    // Need either bbox or geography IDs, unless loading example
    useToastNotification().showToast('Please provide a bounding box or geography IDs.')
    return
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
        wsdotReport.value = progress.extraData as WSDOTReport
        wsdotStopsRoutesReport.value = processWsdotStopsRoutesReport(scenarioData.value, wsdotReport.value)
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
