<template>
  <div>
    <tl-title title="WSDOT Frequent Transit Service Study" />

    <t-msg
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
        To change the analysis area, navigate to the <t-icon
          icon="magnify"
          style="vertical-align:middle;"
        /> <strong>Query tab</strong> and modify your geographic bounds, then select "Run Advanced Analysis" to return to this page.
      </p>
    </t-msg>

    <t-msg
      v-if="error"
      variant="danger"
      class="mt-4"
      style="width:400px"
      :title="error.message"
    >
      An error occurred while running the WSDOT analysis.
    </t-msg>
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

        <t-msg
          v-if="debugMenu"
          variant="warning"
          class="mt-4"
          title="Debug menu"
        >
          <t-field label="Example configuration">
            <t-select v-model="selectedExample">
              <option value="">
                Select an example...
              </option>
              <option
                v-for="example of exampleConfigs"
                :key="example.filename"
                :value="example.filename"
              >
                {{ example.config.reportName }}
              </option>
            </t-select>
          </t-field>
          <br>
        </t-msg>

        <div class="card-content">
          <t-field>
            <template #label>
              <t-tooltip text="The weekday date is used to analyze peak hours, extended hours, and night segments. This determines which specific Monday-Friday schedule is used for frequency calculations.">
                Weekday date
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-datepicker v-model="wsdotReportConfig!.weekdayDate" />
          </t-field>

          <t-field>
            <template #label>
              <t-tooltip text="The weekend date is used to analyze weekend service patterns. This determines which specific Saturday/Sunday schedule is used for frequency calculations.">
                Weekend date
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-datepicker v-model="wsdotReportConfig!.weekendDate" />
          </t-field>

          <t-field>
            <template #label>
              <t-tooltip text="The buffer radius around each transit stop used for population analysis. This determines how far from each stop to count residents when calculating accessibility metrics.">
                Stop buffer radius (meters)
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <div class="level">
              <div class="level-item">
                <t-slider
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
          </t-field>
        </div>
        <footer class="card-footer">
          <div
            class="field is-grouped is-grouped-right"
            style="width: 100%; padding: 0.75rem;"
          >
            <div class="control">
              <t-button
                variant="light"
                @click="handleCancel"
              >
                Cancel
              </t-button>
            </div>
            <div class="control">
              <t-button
                variant="primary"
                @click="runQuery"
              >
                Run Report
              </t-button>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- Loading Progress Modal - positioned at the end for highest z-index -->
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
import type { WSDOTReport, WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { WSDOTReportDataReceiver } from '~~/src/analysis/wsdot'
import { type ScenarioData, type ScenarioConfig, ScenarioStreamReceiver, type ScenarioProgress } from '~~/src/scenario'
import { SCENARIO_DEFAULTS } from '~~/src/core'

interface ExampleConfig {
  filename: string
  config: WSDOTReportConfig
  hasError: boolean
}

const debugMenu = useDebugMenu()
const route = useRoute()
const router = useRouter()
const error = ref<Error>()
const loading = ref(false)
const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress>()
const stopDepartureCount = ref<number>(0)
const scenarioConfig = defineModel<ScenarioConfig>('scenarioConfig', { required: true })
const scenarioData = shallowRef<ScenarioData>()
const wsdotReport = shallowRef<WSDOTReport>()

// Example configurations from index.json
const exampleConfigs = ref<ExampleConfig[]>([])
const selectedExample = ref<string>(String(route.query.selectedExample || ''))
const wsdotReportConfig = ref<WSDOTReportConfig>({
  ...SCENARIO_DEFAULTS,
  ...scenarioConfig.value,
  reportName: 'wsdot-report',
  weekdayDate: scenarioConfig.value!.startDate!,
  weekendDate: scenarioConfig.value!.endDate!,
  // WSDOT-specific required properties (not in ScenarioConfig)
  stopBufferRadius: 800, // Override default of 0
  aggregateLayer: 'state',
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

// Load example configurations from index.json
const loadExampleConfigs = async () => {
  try {
    const response = await fetch('/api/examples')
    if (!response.ok) {
      throw new Error(`Failed to fetch examples: ${response.status}`)
    }
    const data = await response.json()
    exampleConfigs.value = data.files.filter((file: ExampleConfig) =>
      file.filename.includes('.wsdot.') && !file.hasError,
    )
  } catch (err) {
    console.error('Failed to load example configurations:', err)
  }
}

// Watch for changes in selectedExample and auto-load
watch(selectedExample, (newValue) => {
  if (newValue) {
    const example = exampleConfigs.value.find(config => config.filename === newValue)
    console.log('Selected example:', newValue, example)
    if (!example) {
      return
    }

    // Update wsdotReportConfig with all values from the example
    Object.assign(wsdotReportConfig.value!, {
      ...example.config,
      // Convert date strings back to Date objects if needed
      weekdayDate: new Date(example.config.weekdayDate),
      weekendDate: new Date(example.config.weekendDate),
    })
  }
})

// Sync selectedExample with URL query parameter
watch(selectedExample, (newValue) => {
  const currentQuery = { ...route.query }
  if (newValue) {
    currentQuery.selectedExample = newValue
  } else {
    delete currentQuery.selectedExample
  }
  router.replace({ query: currentQuery })
})

// Watch for URL changes to update selectedExample
watch(() => route.query.selectedExample, (newValue) => {
  const newSelectedExample = String(newValue || '')
  if (selectedExample.value !== newSelectedExample) {
    selectedExample.value = newSelectedExample
  }
})

// Load examples on component mount
onMounted(() => {
  loadExampleConfigs()
})

// Expose hasResults to parent component
defineExpose({
  hasResults,
})

const runQuery = async () => {
  showLoadingModal.value = true
  try {
    await fetchScenario()
  } catch (err: any) {
    error.value = err
  }
  if (!error.value) {
    useToastNotification().showToast('WSDOT analysis completed successfully!')
    showLoadingModal.value = false
  }
  loadingProgress.value = undefined
}

const fetchScenario = async () => {
  const config = wsdotReportConfig.value!
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    // Need either bbox or geography IDs, unless loading example
    useToastNotification().showToast('Please provide a bounding box or geography IDs.')
    return
  }
  loadingProgress.value = undefined
  stopDepartureCount.value = 0

  // Create receiver to accumulate scenario data and WSDOT report
  const receiver = new WSDOTReportDataReceiver({
    onProgress: (progress: ScenarioProgress) => {
      loadingProgress.value = progress
      stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0
      scenarioData.value = receiver.getCurrentData()
    },
    onComplete: () => {
      loadingProgress.value = undefined
      // Get final data from receiver
      scenarioData.value = receiver.getCurrentData()
      wsdotReport.value = receiver.getCurrentWSDOTReport()
    },
    onError: (err: any) => {
      loadingProgress.value = undefined
      error.value = err
    },
  })

  let response: Response
  if (selectedExample.value) {
    // Load example data from public JSON file
    response = await fetch(`/examples/${selectedExample.value}`)
  } else {
  // Make request to streaming scenario endpoint
    const apiFetch = await useApiFetch()
    response = await apiFetch('/api/wsdot', {
      method: 'POST',
      body: JSON.stringify({ config: wsdotReportConfig.value }),
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

<style>
/* Ensure modal is always on top */
.tl-modal {
  z-index: 99999 !important;
}
</style>
