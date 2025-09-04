<template>
  <div class="cal-report">
    <tl-title title="WSDOT Frequent Transit Service Study" />

    <tl-msg-info>
      <h5 class="title is-5">
        About this Analysis
      </h5>
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
    <div v-else-if="wsdotReportConfig && wsdotReport">
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
          <tl-msg-warning v-if="debugMenu" class="mt-4" style="width:400px" title="Debug menu">
            <o-field label="Example regions">
              <o-select v-model="cannedBbox">
                <option v-for="[cannedBboxName, cannedBboxDetails] of cannedBboxes.entries()" :key="cannedBboxName" :value="cannedBboxName">
                  {{ cannedBboxDetails.label }}
                </option>
              </o-select>
              <o-button @click="loadExampleWsdotReport">
                Load example
              </o-button>
            </o-field>
            <br>
          </tl-msg-warning>

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
            <o-slider v-model="wsdotReportConfig!.stopBufferRadius" :min="1" :max="1000" />
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
              <o-button variant="primary" :title="!scenarioData ? 'You need to load scenario data before starting this analysis.' : ''" @click="runQuery">
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
      title="Loading Scenario Data"
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
import { cannedBboxes } from '~/src/constants'
import { type ScenarioData, type ScenarioConfig, ScenarioDataReceiver, ScenarioStreamReceiver, type ScenarioProgress } from '~/src/scenario'

const error = ref<Error | null>(null)
const loading = ref(false)
const debugMenu = useDebugMenu()
const cannedBbox = ref('portland')
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotReport = ref<WSDOTReport | null>(null)
const wsdotReportConfig = ref<WSDOTReportConfig>({
  weekdayDate: scenarioConfig.value!.startDate!,
  weekendDate: scenarioConfig.value!.endDate!,
  scheduleEnabled: true,
  stopBufferRadius: 800,
})

const emit = defineEmits<{
  cancel: []
}>()

const loadExampleWsdotReport = async () => {
  alert('Temporarily disabled')
  // loading.value = true
  // const reportFile = `/examples/${cannedBbox.value}.wsdot.json`
  // const data: { config: WSDOTReportConfig, report: WSDOTReport } = await fetch(reportFile)
  //   .then(res => res.json())
  // wsdotReportConfig.value = data.config
  // wsdotReport.value = data.report
  // loading.value = false
}

// const runWsdotReport = async () => {
//   console.log('runWsdotReport')
//   loading.value = true

//   try {
//     const wsdotConfig: WSDOTReportConfig = {
//       ...scenarioConfig.value,
//       weekdayDate: scenarioConfig.value?.startDate || new Date(),
//       weekendDate: scenarioConfig.value?.endDate || new Date(),
//       scheduleEnabled: true,
//       stopBufferRadius: wsdotReportConfig.value.stopBufferRadius,
//     }

//     // Use authenticated fetch to automatically include JWT token
//     const apiFetch = await useApiFetch()
//     const response = await apiFetch('/api/wsdot', {
//       method: 'POST',
//       body: JSON.stringify({
//         config: wsdotConfig,
//       })
//     })
//     const responseData = await response.json()
//     wsdotReport.value = responseData as WSDOTReport
//     wsdotReportConfig.value = wsdotConfig
//   } catch (e) {
//     console.error('WSDOT analysis failed:', e)
//     error.value = { message: 'Failed to load WSDOT report' } as Error
//   } finally {
//     loading.value = false
//   }
// }

const showLoadingModal = ref(false)
const loadingProgress = ref<ScenarioProgress | null>(null)
const stopDepartureCount = ref<number>(0)

// Scenario fetching logic
function runQuery () {
  fetchScenario('')
}

const fetchScenario = async (loadExample: string) => {
  console.log('fetchScenario:', loadExample)
  const config = scenarioConfig.value!
  if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    return // Need either bbox or geography IDs, unless loading example
  }
  try {
    showLoadingModal.value = true
    loadingProgress.value = null
    stopDepartureCount.value = 0

    // Create receiver to accumulate scenario data
    const receiver = new ScenarioDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        // Update progress for modal
        loadingProgress.value = progress
        stopDepartureCount.value += progress.partialData?.stopDepartures.length || 0
        console.log(`Stop departures loaded: ${stopDepartureCount.value}`)

        // Apply filters to partial data and emit (without schedule-dependent features)
        // Skip if no route/stop data
        if (progress.partialData?.routes.length === 0 && progress.partialData?.stops.length === 0) {
          return
        }
        scenarioData.value = receiver.getCurrentData()
      },
      onComplete: () => {
        // Get final accumulated data and apply filters
        loadingProgress.value = null
        scenarioData.value = receiver.getCurrentData()

        // Auto-close modal and show success toast notification
        showLoadingModal.value = false
        useToastNotification().showToast('Scenario data loaded successfully!')
      },
      onError: (err: any) => {
        showLoadingModal.value = false
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
      response = await apiFetch('/api/scenario', {
        method: 'POST',
        body: JSON.stringify(config)
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
  } catch (err: any) {
    console.error('Scenario fetch error:', err)
    error.value = err
    showLoadingModal.value = false
    loadingProgress.value = null
  }
}

const handleCancel = () => {
  emit('cancel')
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
