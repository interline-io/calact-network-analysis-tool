<template>
  <div class="analysis-picker">
    <!-- Dynamic analysis component -->
    <component
      :is="analysisComponents[selectedReportType].component"
      v-if="selectedReportType && analysisComponents && analysisComponents[selectedReportType]"
      :scenario-config="scenarioConfig"
      :scenario-data="scenarioData"
      @cancel="handleCancel"
    />
    <!-- Analysis selection interface -->
    <div v-else>
      <tl-title title="Analysis" />
      <tl-msg-info>
        <p>For richer metrics than included in the <o-icon icon="file-chart" style="vertical-align:middle;" /> <strong>Report tab</strong> by default, run an analysis.</p>
        <p>Additional analyses can be added and customized for stakeholders by the project team.</p>
      </tl-msg-info>

      <!-- Warning when no scenario data is available -->
      <tl-msg-warning v-if="!scenarioConfig">
        You need to define the geographic extent before running analyses. Please go to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to load transit stops and routes for your selected geographic extent.
      </tl-msg-warning>

      <o-field label="Start an analysis">
        <o-select
          v-model="selectedReportType"
          placeholder="Select an analysis to run"
          :disabled="!scenarioConfig"
        >
          <option v-for="[reportType, reportLabel] of Object.entries(analysisTypes)" :key="reportType" :value="reportType">
            {{ reportLabel }}
          </option>
        </o-select>
      </o-field>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, computed, ref, watch } from 'vue'
import type { ScenarioData, ScenarioConfig } from '~/src/scenario'

const route = useRoute()
const router = useRouter()

const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')

// Analysis type registry - easily add new analyses here
const analysisTypes: Record<string, string> = {
  'wsdot': 'WSDOT Frequent Transit Service Study',
  'wsdot-stops-routes': 'WSDOT Transit Stops and Transit Routes',
}

// Analysis component registry - maps analysis types to their components
const analysisComponents: Record<string, { component: any }> = {
  'wsdot': { component: defineAsyncComponent(() => import('./wsdot.vue')) },
  'wsdot-stops-routes': { component: defineAsyncComponent(() => import('./wsdot-stops-routes.vue')) },
}

// Initialize selectedReportType from query parameter
const selectedReportType = ref<string>(String(route.query.advancedReport || ''))

// Sync selectedReportType with URL query parameter
watch(selectedReportType, (newValue) => {
  const currentQuery = { ...route.query }
  if (newValue) {
    currentQuery.advancedReport = newValue
  } else {
    delete currentQuery.advancedReport
  }
  router.replace({ query: currentQuery })
})

// Watch for URL changes to update selectedReportType
watch(() => route.query.advancedReport, (newValue) => {
  const newSelectedReport = String(newValue || '')
  if (selectedReportType.value !== newSelectedReport) {
    selectedReportType.value = newSelectedReport
  }
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
  hasAnalysisResults
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
