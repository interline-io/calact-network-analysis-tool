<template>
  <div>
    <cal-title title="WSDOT Frequent Transit Service Study" />

    <cat-msg
      variant="info"
      title="About this Analysis"
      expandable
      :open="!hasResults"
    >
      <p class="mb-3">
        The Washington State Department of Transportation (WSDOT) <a
          href="https://wsdot.wa.gov/construction-planning/search-studies/frequent-transit-service-study"
          target="_blank"
        >Frequent Transit Service Study</a> analyzes statewide transit service benchmarks and identifies gaps in accessible, frequent fixed-route transit.
        This study defines seven levels of transit frequency based on headway, span, and days of service.
        Generally, this website uses the word "frequency" to describe the intensity of service on transit routes, and "visits" to describe intensity of service at individual stops. This specific analysis uses the word frequency to describe service intensity at individual stops because of the past definition of the process determined by a group of WSDOT partners, but bases these calculations only on the most frequent route with service at each stop.
      </p>
      <p>
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified.
        To change the analysis area, navigate to the <cat-icon
          icon="magnify"
          style="vertical-align:middle;"
        /> <strong>Query tab</strong> and modify your geographic bounds, then select "Run Advanced Analysis" to return to this page.
      </p>
    </cat-msg>

    <cat-msg
      v-if="error"
      variant="danger"
      class="mt-4"
      style="width:400px"
      :title="error.message"
    >
      An error occurred while running the WSDOT analysis.
    </cat-msg>
    <div v-else-if="wsdotReport">
      <analysis-wsdot-viewer
        :report="wsdotReport"
        :config="wsdotReportConfig"
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
              <cat-tooltip text="The weekday date is used to analyze peak hours, extended hours, and night segments. This determines which specific Monday-Friday schedule is used for frequency calculations.">
                Weekday date
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </cat-field>

          <cat-field>
            <template #label>
              <cat-tooltip text="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used for frequency calculations.">
                Weekend date
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <cat-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </cat-field>

          <cat-field>
            <template #label>
              <cat-tooltip text="The buffer radius around each transit stop used for population analysis. This determines how far from each stop to count residents when calculating accessibility metrics.">
                Stop buffer radius (meters)
                <cat-icon icon="information" />
              </cat-tooltip>
            </template>
            <div class="level">
              <div class="level-item">
                <cat-slider
                  v-model="wsdotReportConfig!.stopBufferRadius"
                  :min="0"
                  :max="1000"
                />
              </div>
              <div class="level-right">
                <div class="ml-4 level-item">
                  <span class="has-text-weight-semibold">
                    {{ wsdotReportConfig!.stopBufferRadius }} m
                  </span>
                </div>
              </div>
            </div>
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
          <div
            class="field is-grouped is-grouped-right"
            style="width: 100%; padding: 0.75rem;"
          >
            <div class="control">
              <cat-button
                variant="light"
                @click="handleCancel"
              >
                Cancel
              </cat-button>
            </div>
            <div class="control">
              <cat-button
                variant="primary"
                @click="runQuery"
              >
                Run Report
              </cat-button>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- Loading Progress Modal - positioned at the end for highest z-index -->
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
        :phase-plan="scenarioPhasePlan"
        :phase-fractions="scenarioPhaseFractions"
        :scenario-data="scenarioData"
      />
    </cat-modal>
  </div>
</template>

<script lang="ts" setup>
import type { ScenarioData, ScenarioConfig } from '~~/src/scenario'

const scenarioConfig = defineModel<ScenarioConfig>('scenarioConfig', { required: true })
const scenarioData = shallowRef<ScenarioData>()

// Report scaffolding shared with the stops-and-routes report: config, stream
// state, receiver, and the run lifecycle around the loading modal.
const {
  loadingProgress,
  error,
  requestErrors,
  phasePlan: scenarioPhasePlan,
  phaseFractions: scenarioPhaseFractions,
  stopDepartureCount,
  showLoadingModal,
  wsdotReport,
  wsdotReportConfig,
  runQuery,
} = useWsdotReport({
  scenarioConfig,
  scenarioData,
  successToast: 'WSDOT analysis completed successfully!',
  configExtras: {
    // This report has no map; route shapes are 98% of the routes query and are
    // never read here. The stops-and-routes report, which exports them, leaves
    // this alone.
    includeRouteGeometry: false,
    // Only the aggregation layer is read, for each stop's state name.
    includeAllCensusLayers: false,
    stopBufferRadius: 800, // Override default of 0
    aggregateLayer: 'state',
  },
})

const emit = defineEmits<{
  cancel: []
}>()

// Track if results are loaded, to collapse the about message, also for navigation guard
const { setHasResults } = useAnalysisResults()
const hasResults = computed(() => {
  const hasResultsValue = wsdotReport.value !== undefined
  setHasResults('wsdot', hasResultsValue)
  return hasResultsValue
})

const handleCancel = () => {
  emit('cancel')
}

// Expose hasResults to parent component
defineExpose({
  hasResults,
})
</script>
