<template>
  <div>
    <tl-title title="WSDOT Frequent Transit Service Study" />

    <tl-msg-info
      collapsible
      :collapsed="hasResults"
      title="About this Analysis"
    >
      <p class="mb-3">
        The Washington State Department of Transportation (WSDOT) Frequent Transit Service Study analyzes statewide transit service benchmarks and identifies gaps in accessible, frequent fixed-route transit.
        This study defines seven levels of transit frequency based on headway, span, and days of service.
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
          <o-field>
            <template #label>
              <o-tooltip multiline label="The weekday date is used to analyze peak hours, extended hours, and night segments. This determines which specific Monday-Friday schedule is used for frequency calculations.">
                Weekday date
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </o-field>

          <o-field>
            <template #label>
              <o-tooltip multiline label="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used for frequency calculations.">
                Weekend date
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </o-field>

          <o-field label="Stop buffer radius (m)">
            <template #label>
              <o-tooltip multiline label="The buffer radius around each transit stop used for population analysis. This determines how far from each stop to count residents when calculating accessibility metrics.">
                Stop buffer radius (meters)
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-slider v-model="wsdotReportConfig!.stopBufferRadius" :min="0" :max="1000" />
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

    <!-- Loading Progress Modal - positioned at the end for highest z-index -->
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
import type { WSDOTReport, WSDOTReportConfig } from '~/src/analysis/wsdot'
import { type ScenarioData, type ScenarioConfig, ScenarioDataReceiver, ScenarioStreamReceiver, type ScenarioProgress } from '~/src/scenario'

const error = ref<Error | null>(null)
const loading = ref(false)
const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotReport = ref<WSDOTReport | null>(null)
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

// Track if results are loaded, to collapse the about message, also for navigation guard
const { setHasResults } = useAnalysisResults()
const hasResults = computed(() => {
  const hasResultsValue = wsdotReport.value !== null
  setHasResults('wsdot', hasResultsValue)
  return hasResultsValue
})

const handleCancel = () => {
  emit('cancel')
}

// Expose hasResults to parent component
defineExpose({
  hasResults
})

const runQuery = async () => {
  showLoadingModal.value = true
  try {
    await fetchScenario('')
  } catch (err: any) {
    error.value = err
  }
  if (!error.value) {
    useToastNotification().showToast('WSDOT analysis completed successfully!')
    showLoadingModal.value = false
  }
  loadingProgress.value = null
}

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
