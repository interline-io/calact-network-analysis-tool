<template>
  <div>
    <tl-title title="WSDOT Transit Stops and Routes" />

    <t-msg
      variant="info"
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
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please cancel to go back to the <t-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
      </p>
    </t-msg>

    <t-msg v-if="error" variant="danger" class="mt-4" style="width:400px" :title="error.message">
      An error occurred while running the WSDOT analysis.
    </t-msg>
    <div v-else-if="loading" class="has-text-centered">
      <t-loading :active="true" :full-page="false" />
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
          <t-field>
            <template #label>
              <t-tooltip text="The weekday date is used to analyze transit service. This determines which specific Monday-Friday schedule is used.">
                Weekday date
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </t-field>

          <t-field>
            <template #label>
              <t-tooltip text="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used.">
                Weekend date
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </t-field>
        </div>
        <footer class="card-footer">
          <div class="field is-grouped is-grouped-right" style="width: 100%; padding: 0.75rem;">
            <div class="control">
              <t-button outlined @click="handleCancel">
                Cancel
              </t-button>
            </div>
            <div class="control">
              <t-button variant="primary" @click="runQuery">
                Run Report
              </t-button>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- Loading Progress Modal -->
    <t-modal
      v-model="showLoadingModal"
      title="Loading"
      :closable="false"
    >
      <cal-scenario-loading
        :progress="loadingProgress"
        :error="error"
        :stop-departure-count="stopDepartureCount"
        :scenario-data="scenarioData"
      />
    </t-modal>
  </div>
</template>

<script lang="ts" setup>
import { useApiFetch } from '~/composables/useApiFetch'
import type {
  WSDOTReport,
  WSDOTReportConfig
} from '~~/src/analysis/wsdot'
import {
  WSDOTReportDataReceiver
} from '~~/src/analysis/wsdot'
import {
  processWsdotStopsRoutesReport,
} from '~~/src/analysis/wsdot-stops-routes'
import { SCENARIO_DEFAULTS } from '~~/src/core/constants'
import type {
  WSDOTStopsRoutesReport,
} from '~~/src/analysis/wsdot-stops-routes'
import {
  ScenarioStreamReceiver,
} from '~~/src/scenario'
import type {
  ScenarioData,
  ScenarioConfig,
  ScenarioProgress,
} from '~~/src/scenario'

const error = ref<Error | null>(null)
const loading = ref(false)
const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)
const scenarioConfig = defineModel<ScenarioConfig>('scenarioConfig', { required: true })
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotReport = ref<WSDOTReport | null>(null)
const wsdotStopsRoutesReport = ref<WSDOTStopsRoutesReport | null>(null)
const wsdotReportConfig = ref<WSDOTReportConfig>({
  // WSDOT-specific required properties (not in ScenarioConfig)
  ...SCENARIO_DEFAULTS,
  ...scenarioConfig.value,
  reportName: 'wsdot-report',
  weekdayDate: scenarioConfig.value!.startDate!,
  weekendDate: scenarioConfig.value!.endDate!,
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

  // Create receiver to accumulate scenario data and WSDOT report
  const receiver = new WSDOTReportDataReceiver({
    onProgress: (progress: ScenarioProgress) => {
      loadingProgress.value = progress
      stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0
      if (progress.partialData?.routes.length === 0 && progress.partialData?.stops.length === 0) {
        return
      }
      // Update both scenario data and WSDOT report from the receiver
      scenarioData.value = receiver.getCurrentData()
      wsdotReport.value = receiver.getCurrentWSDOTReport()
      if (scenarioData.value && wsdotReport.value) {
        wsdotStopsRoutesReport.value = processWsdotStopsRoutesReport(scenarioData.value, wsdotReport.value)
      }
    },
    onComplete: () => {
      loadingProgress.value = null
      // Get final data from receiver
      scenarioData.value = receiver.getCurrentData()
      wsdotReport.value = receiver.getCurrentWSDOTReport()
      if (scenarioData.value && wsdotReport.value) {
        wsdotStopsRoutesReport.value = processWsdotStopsRoutesReport(scenarioData.value, wsdotReport.value)
      }
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
