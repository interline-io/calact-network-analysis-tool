<template>
  <div>
    <cal-title title="WSDOT Transit Stops and Routes" />

    <cat-card
      label="About this Analysis"
      expandable
      :open="!hasResults"
    >
      <cat-msg variant="info">
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
          This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please cancel to go back to the <cat-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
        </p>
      </cat-msg>
    </cat-card>

    <cat-msg v-if="error" variant="danger" class="mt-4" style="width:400px" :title="error.message">
      An error occurred while running the WSDOT analysis.
    </cat-msg>
    <div v-else-if="loading" class="has-text-centered">
      <cat-loading :active="true" :full-page="false" />
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
          <cat-field>
            <template #label>
              <cat-tooltip text="The weekday date is used to analyze transit service. This determines which specific Monday-Friday schedule is used.">
                Weekday date
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </cat-field>

          <cat-field>
            <template #label>
              <cat-tooltip text="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used.">
                Weekend date
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </cat-field>

          <cal-census-dataset-picker
            v-model="wsdotReportConfig!.geoDatasetName"
            label="Census geography dataset"
            tooltip="Select which version of TIGER census boundaries to use for geographic analysis."
            name-filter="tiger"
          />
          <cal-census-dataset-picker
            v-model="wsdotReportConfig!.tableDatasetName"
            label="Census demographics dataset"
            tooltip="Select which version of ACS demographics data to use for population analysis."
            name-filter="acs"
          />
        </div>
        <footer class="card-footer">
          <div class="field is-grouped is-grouped-right" style="width: 100%; padding: 0.75rem;">
            <div class="control">
              <cat-button variant="light" @click="handleCancel">
                Cancel
              </cat-button>
            </div>
            <div class="control">
              <cat-button variant="primary" @click="runQuery">
                Run Report
              </cat-button>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- Loading Progress Modal -->
    <cat-modal
      v-model="showLoadingModal"
      title="Loading"
      :closable="!!error || requestErrors.length > 0"
    >
      <cal-scenario-loading
        :progress="loadingProgress"
        :error="error"
        :request-errors="requestErrors"
        :stop-departure-count="stopDepartureCount"
        :stops-with-departures="stopsWithDepartures"
        :phase-plan="scenarioPhasePlan"
        :phase-fractions="scenarioPhaseFractions"
        :scenario-data="scenarioData"
      />
    </cat-modal>
  </div>
</template>

<script lang="ts" setup>
import {
  processWsdotStopsRoutesReport,
} from '~~/src/analysis/wsdot-stops-routes'
import type {
  WSDOTStopsRoutesReport,
} from '~~/src/analysis/wsdot-stops-routes'
import type {
  ScenarioData,
  ScenarioConfig,
} from '~~/src/scenario'

const loading = ref(false)
const scenarioConfig = defineModel<ScenarioConfig>('scenarioConfig', { required: true })
const scenarioData = defineModel<ScenarioData>('scenarioData')
const wsdotStopsRoutesReport = ref<WSDOTStopsRoutesReport>()

// Report scaffolding shared with the frequency report: config, stream state,
// receiver, and the run lifecycle around the loading modal. This report is
// derived on top of the base WSDOT report once it completes.
const {
  loadingProgress,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  stopDepartureCount,
  stopsWithDepartures,
  showLoadingModal,
  wsdotReport,
  wsdotReportConfig,
  runQuery: runReport,
} = useWsdotReport({
  scenarioConfig,
  scenarioData,
  successToast: 'WSDOT stops and routes analysis completed successfully!',
  onComplete: (data, report) => {
    wsdotStopsRoutesReport.value = processWsdotStopsRoutesReport(data, report)
  },
})

const emit = defineEmits<{
  cancel: []
}>()

// Track if results are loaded, to collapse the about message, also for navigation guard
const { setHasResults } = useAnalysisResults()
const hasResults = computed(() => {
  const hasResultsValue = wsdotStopsRoutesReport.value !== undefined
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
const runQuery = () => runReport()
</script>
