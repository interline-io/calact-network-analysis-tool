<template>
  <div class="analysis-picker">
    <!-- Dynamic analysis component -->
    <component
      :is="analysisComponents[selectedReportType]?.component"
      v-if="selectedReportType && analysisComponents && analysisComponents[selectedReportType]"
      :scenario-config="scenarioConfig"
      :scenario-data="scenarioData"
      :fetch-mode="fetchMode"
      @cancel="handleCancel"
    />
    <!-- Analysis selection interface -->
    <div v-else>
      <cal-title title="Analysis" />
      <cat-msg variant="info">
        <p>
          For richer metrics than included in the <cat-icon
            icon="file-chart"
            style="vertical-align:middle;"
          /> <strong>Report tab</strong> by default, run an analysis.
        </p>
        <p>Additional analyses can be added and customized for stakeholders by the project team.</p>
      </cat-msg>

      <!-- Warning when no scenario data is available (only if all analyses require it) -->
      <cat-msg
        v-if="!scenarioConfig && !hasStandaloneAnalyses"
        variant="danger"
      >
        You need to define the geographic extent before running analyses. Please go to the <cat-icon
          icon="magnify"
          style="vertical-align:middle;"
        /> <strong>Query tab</strong> to load transit stops and routes for your selected geographic extent.
      </cat-msg>

      <cat-field label="Start an analysis">
        <cat-select
          v-model="selectedReportType"
        >
          <option
            value=""
            disabled
            selected
          >
            Select an analysis to run
          </option>
          <option
            v-for="[reportType, analysis] of Object.entries(analysisTypes)"
            :key="reportType"
            :value="reportType"
            :disabled="analysis.requiresScenario && !scenarioConfig"
          >
            {{ analysis.label }}{{ analysis.requiresScenario && !scenarioConfig ? ' (requires geographic extent)' : '' }}
          </option>
        </cat-select>
      </cat-field>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, computed } from 'vue'
import type { ScenarioData, ScenarioConfig } from '~~/src/scenario'
import type { FetchMode } from '~/composables/useOpenStream'

defineProps<{
  fetchMode: FetchMode
}>()
const scenarioConfig = defineModel<ScenarioConfig>('scenarioConfig')
const scenarioData = defineModel<ScenarioData>('scenarioData')

// Analysis type registry - easily add new analyses here
const analysisTypes: Record<string, { label: string, requiresScenario: boolean }> = {
  'wsdot': { label: 'WSDOT Frequent Transit Service Study', requiresScenario: true },
  'wsdot-stops-routes': { label: 'WSDOT Transit Stops and Transit Routes', requiresScenario: true },
  'visioneval': { label: 'NTD annual agency metrics for VisionEval', requiresScenario: false },
}

// Check if any analysis that doesn't require scenario is available
const hasStandaloneAnalyses = computed(() => {
  return Object.values(analysisTypes).some(a => !a.requiresScenario)
})

// Analysis component registry - maps analysis types to their components
const analysisComponents: Record<string, { component: any }> = {
  'wsdot': { component: defineAsyncComponent(() => import('./wsdot.vue')) },
  'wsdot-stops-routes': { component: defineAsyncComponent(() => import('./wsdot-stops-routes.vue')) },
  'visioneval': { component: defineAsyncComponent(() => import('./visioneval.vue')) },
}

// The selected report type, kept in the URL.
const { query, setQuery } = useUrlQuery()
const selectedReportType = computed<string>({
  get: () => String(query.value.advancedReport || ''),
  set: (v) => { setQuery({ advancedReport: v || undefined }) },
})

const { hasResultsState } = useAnalysisResults()

const emit = defineEmits<{
  cancel: []
}>()

// Check if any analysis has results
const hasAnalysisResults = computed(() => {
  if (!scenarioData.value || selectedReportType.value === '') {
    return false
  }
  // Use the persistent state
  const hasResults = hasResultsState.value[selectedReportType.value] || false
  return hasResults
})

const handleCancel = () => {
  selectedReportType.value = ''
  emit('cancel')
}

// Expose hasAnalysisResults to parent component
defineExpose({
  hasAnalysisResults,
})
</script>

<style scoped lang="scss">
.analysis-picker {
  display: flex;
  flex-direction: column;
  background: var(--bulma-scheme-main);
  height: 100vh;
  width: calc(100vw - 100px);
  padding-left:20px;
  padding-right:20px;
}
</style>
