<template>
  <div class="cal-report">
    <div v-if="selectedReportType === 'wsdot'">
      <analysis-wsdot
        :scenario-config="scenarioConfig"
        :scenario-data="scenarioData"
        @cancel="handleCancel"
      />
    </div>
    <div v-else-if="selectedReportType === 'wsdot-stops-routes'">
      <analysis-wsdot-stops-routes
        :scenario-config="scenarioConfig"
        :scenario-data="scenarioData"
        @cancel="handleCancel"
      />
    </div>
    <div v-else>
      <tl-title title="Analysis" />
      <tl-msg-info>
        <p>For richer metrics than included in the <o-icon icon="file-chart" style="vertical-align:middle;" /> <strong>Report tab</strong> by default, run an analysis.</p>
        <p>Additional analyses can be added and customized for stakeholders by the project team.</p>
      </tl-msg-info>

      <!-- Warning when no scenario data is available -->
      <tl-msg-warning v-if="!scenarioData">
        You need to load data before running analyses. Please go to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to load transit stops and routes for your selected geographic extent.
      </tl-msg-warning>

      <o-field label="Start an analysis">
        <o-select
          v-model="selectedReportType"
          placeholder="Select an analysis to run"
          :disabled="!scenarioData"
        >
          <option v-for="[reportType, reportLabel] of Object.entries(reportTypes)" :key="reportType" :value="reportType">
            {{ reportLabel }}
          </option>
        </o-select>
      </o-field>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { ScenarioData, ScenarioConfig } from '~/src/scenario/scenario'

const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')

const reportTypes: Record<string, string> = {
  'wsdot': 'WSDOT Frequent Transit Service Study',
  'wsdot-stops-routes': 'WSDOT Transit Stops and Transit Routes',
}
const selectedReportType = ref<string>('')

const handleCancel = () => {
  selectedReportType.value = ''
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
