<template>
  <div>
    <tl-title title="VisionEval Transit Service Data" />

    <t-card
      label="About this Analysis"
      expandable
      :open="!hasResults"
    >
      <t-msg variant="info" class="content">
        <p class="mb-3">
          This analysis uses US National Transit Database annual metrics datasets to generates CSV files to import into <strong>VisionEval</strong> policy modeling software.
        </p>
        <ul>
          <li><code>marea_transit_service.csv</code> Vehicle Revenue Miles by urbanized area and mode</li>
          <li><code>cost_per_revenue_mile.csv</code> Operating cost per revenue mile by mode</li>
        </ul>
        <p class="mb-3">
          NTD modes are mapped to VisionEval modes.
        </p>
        <p>
          Non-urbanized area (Non-UZA) records are excluded from the output.
        </p>
      </t-msg>
    </t-card>

    <t-msg v-if="error" variant="danger" class="mt-4" style="width:500px" :title="error.message">
      An error occurred while running the VisionEval analysis.
    </t-msg>
    <div v-else-if="loading" class="has-text-centered mt-4">
      <t-loading :active="true" :full-page="false" />
      <p class="mt-4">
        {{ loadingMessage }}
      </p>
    </div>
    <div v-else-if="report">
      <analysis-visioneval-viewer
        v-model:report="report"
      />
    </div>
    <div v-else>
      <div class="card mt-4">
        <header class="card-header">
          <p class="card-header-title">
            Configure Report
          </p>
        </header>
        <div class="card-content">
          <t-field>
            <template #label>
              <t-tooltip text="Filter NTD data to agencies in this state.">
                State
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-select v-model="configState">
              <option value="" disabled>
                Select a state
              </option>
              <option v-for="state in US_STATES" :key="state.abbr" :value="state.abbr">
                {{ state.name }} ({{ state.abbr }})
              </option>
            </t-select>
          </t-field>

          <t-field>
            <template #label>
              <t-tooltip text="NTD report year. Prior year data is typically available each November.">
                Report Year
                <t-icon icon="information" />
              </t-tooltip>
            </template>
            <t-select v-model="configYear">
              <option v-for="year in AVAILABLE_YEARS" :key="year" :value="year">
                {{ year }}
              </option>
            </t-select>
          </t-field>
        </div>
        <footer class="card-footer">
          <div class="field is-grouped is-grouped-right" style="width: 100%; padding: 0.75rem;">
            <div class="control">
              <t-button variant="light" @click="handleCancel">
                Cancel
              </t-button>
            </div>
            <div class="control">
              <t-button
                variant="primary"
                :disabled="!canRun"
                @click="runQuery"
              >
                Run Report
              </t-button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useApiFetch } from '~/composables/useApiFetch'
import type {
  VisionEvalConfig,
  VisionEvalReport,
  VisionEvalProgress,
} from '~~/src/analysis/visioneval'

// US States for selection
const US_STATES = [
  { abbr: 'AL', name: 'Alabama' },
  { abbr: 'AK', name: 'Alaska' },
  { abbr: 'AZ', name: 'Arizona' },
  { abbr: 'AR', name: 'Arkansas' },
  { abbr: 'CA', name: 'California' },
  { abbr: 'CO', name: 'Colorado' },
  { abbr: 'CT', name: 'Connecticut' },
  { abbr: 'DE', name: 'Delaware' },
  { abbr: 'FL', name: 'Florida' },
  { abbr: 'GA', name: 'Georgia' },
  { abbr: 'HI', name: 'Hawaii' },
  { abbr: 'ID', name: 'Idaho' },
  { abbr: 'IL', name: 'Illinois' },
  { abbr: 'IN', name: 'Indiana' },
  { abbr: 'IA', name: 'Iowa' },
  { abbr: 'KS', name: 'Kansas' },
  { abbr: 'KY', name: 'Kentucky' },
  { abbr: 'LA', name: 'Louisiana' },
  { abbr: 'ME', name: 'Maine' },
  { abbr: 'MD', name: 'Maryland' },
  { abbr: 'MA', name: 'Massachusetts' },
  { abbr: 'MI', name: 'Michigan' },
  { abbr: 'MN', name: 'Minnesota' },
  { abbr: 'MS', name: 'Mississippi' },
  { abbr: 'MO', name: 'Missouri' },
  { abbr: 'MT', name: 'Montana' },
  { abbr: 'NE', name: 'Nebraska' },
  { abbr: 'NV', name: 'Nevada' },
  { abbr: 'NH', name: 'New Hampshire' },
  { abbr: 'NJ', name: 'New Jersey' },
  { abbr: 'NM', name: 'New Mexico' },
  { abbr: 'NY', name: 'New York' },
  { abbr: 'NC', name: 'North Carolina' },
  { abbr: 'ND', name: 'North Dakota' },
  { abbr: 'OH', name: 'Ohio' },
  { abbr: 'OK', name: 'Oklahoma' },
  { abbr: 'OR', name: 'Oregon' },
  { abbr: 'PA', name: 'Pennsylvania' },
  { abbr: 'RI', name: 'Rhode Island' },
  { abbr: 'SC', name: 'South Carolina' },
  { abbr: 'SD', name: 'South Dakota' },
  { abbr: 'TN', name: 'Tennessee' },
  { abbr: 'TX', name: 'Texas' },
  { abbr: 'UT', name: 'Utah' },
  { abbr: 'VT', name: 'Vermont' },
  { abbr: 'VA', name: 'Virginia' },
  { abbr: 'WA', name: 'Washington' },
  { abbr: 'WV', name: 'West Virginia' },
  { abbr: 'WI', name: 'Wisconsin' },
  { abbr: 'WY', name: 'Wyoming' },
  { abbr: 'DC', name: 'District of Columbia' },
  { abbr: 'PR', name: 'Puerto Rico' },
]

// Available years based on loaded NTD data (strings for HTML select compatibility)
const AVAILABLE_YEARS = ['2024', '2023', '2022']

const error = ref<Error>()
const loading = ref(false)
const loadingMessage = ref('Loading...')
const report = ref<VisionEvalReport>()

// Configuration state (per issue #260: one year and state at a time)
const configState = ref<string>('WA')
const configYear = ref<string>('2024')

const emit = defineEmits<{
  cancel: []
}>()

// Track if results are loaded
const { setHasResults } = useAnalysisResults()
const hasResults = computed(() => report.value !== undefined)

// Sync hasResults state with the composable (using watch to avoid side-effects in computed)
watch(hasResults, (value) => {
  setHasResults('visioneval', value)
}, { immediate: true })

const canRun = computed(() => {
  return configState.value && configYear.value
})

const handleCancel = () => {
  emit('cancel')
}

// Expose hasResults to parent component
defineExpose({
  hasResults
})

// Process the streaming response from the BFF endpoint
const processStream = async (stream: ReadableStream<Uint8Array>): Promise<VisionEvalReport | null> => {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: VisionEvalReport | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { break }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) { continue }
        const progress = JSON.parse(line) as VisionEvalProgress

        // Update loading message
        if (progress.message) {
          loadingMessage.value = progress.message
        }

        // Check for errors
        if (progress.error) {
          throw new Error(progress.error.message || 'Unknown error')
        }

        // Check for completion with report
        if (progress.currentStage === 'complete' && progress.report) {
          result = progress.report
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return result
}

// Run the analysis
const runQuery = async () => {
  loading.value = true
  error.value = undefined
  loadingMessage.value = 'Initializing...'

  try {
    const config: VisionEvalConfig = {
      state: configState.value,
      year: parseInt(configYear.value, 10),
    }

    // Call the BFF endpoint
    const apiFetch = await useApiFetch()
    const response = await apiFetch('/api/visioneval', {
      method: 'POST',
      body: JSON.stringify({ config }),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body')
    }

    // Process the streaming response
    const result = await processStream(response.body)
    if (result) {
      report.value = result
      useToastNotification().showToast('VisionEval analysis completed successfully!')
    } else {
      throw new Error('No report received from server')
    }
  } catch (err: any) {
    console.error('VisionEval analysis error:', err)
    error.value = err
  } finally {
    loading.value = false
  }
}
</script>
