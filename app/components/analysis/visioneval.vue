<template>
  <div>
    <tl-title title="VisionEval Transit Service Data" />

    <t-card
      label="About this Analysis"
      expandable
      :open="!hasResults"
    >
      <t-msg variant="info">
        <p class="mb-3">
          This analysis generates transit service data files for use with <strong>VisionEval</strong>,
          a strategic planning model framework used by state DOTs and MPOs to evaluate the
          outcomes of policy and investment changes on transportation system performance.
        </p>
        <p class="mb-3">
          <strong>Data Source:</strong> National Transit Database (NTD) Annual Data - Metrics table,
          which contains Vehicle Revenue Miles and Operating Expenses by agency, mode, and urbanized area.
        </p>
        <p class="mb-3">
          <strong>Output Files:</strong>
        </p>
        <ul class="mb-3">
          <li><strong>marea_transit_service.csv:</strong> Vehicle Revenue Miles aggregated by Urbanized Area (UZA) and VisionEval transit mode (DR, VP, MB, RB, MG, SR, HR, CR)</li>
          <li><strong>cost_per_revenue_mile.csv:</strong> Statewide cost per revenue mile by mode, calculated from Total Operating Expenses divided by Vehicle Revenue Miles</li>
        </ul>
        <p class="mb-3">
          <strong>Mode Mapping:</strong> NTD modes are mapped to VisionEval modes:
          DR (Demand Response), VP (Vanpool), MB (Bus), RB (Bus Rapid Transit),
          MG (Monorail/Automated Guideway), SR (Streetcar Rail), HR (Heavy Rail), CR (Commuter Rail).
        </p>
        <p>
          Select your state and report year below to generate the analysis.
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
              <t-tooltip text="Select the state to filter NTD data. Only agencies in this state will be included.">
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
              <t-tooltip text="Select the report year. Data for the previous calendar year is typically available in mid-November.">
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
              <t-button outlined @click="handleCancel">
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
import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { BasicGraphQLClient } from '~~/src/core'
import {
  runVisionEvalAnalysis,
  type VisionEvalConfig,
  type VisionEvalReport,
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

// Available years based on loaded NTD data
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
const hasResults = computed(() => {
  const hasResultsValue = report.value !== undefined
  setHasResults('visioneval', hasResultsValue)
  return hasResultsValue
})

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

    // Create GraphQL client
    const apiFetch = await useApiFetch()
    const client = new BasicGraphQLClient(
      useTransitlandApiEndpoint('/query'),
      apiFetch,
    )

    // Run the analysis
    report.value = await runVisionEvalAnalysis(config, client, (message, _count) => {
      loadingMessage.value = message
    })

    useToastNotification().showToast('VisionEval analysis completed successfully!')
  } catch (err: any) {
    console.error('VisionEval analysis error:', err)
    error.value = err
  } finally {
    loading.value = false
  }
}
</script>
