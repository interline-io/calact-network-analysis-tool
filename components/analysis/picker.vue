<template>
  <div class="cal-report">
    <div v-if="selectedReportType === 'wsdot'">
      <analysis-wsdot
        :scenario-config="scenarioConfig"
        :scenario-data="scenarioData"
      />
    </div>
    <div v-else>
      <tl-title title="Analysis" />

      <o-field label="Select analysis">
        <o-select v-model="selectedReportType">
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
  '': 'Pick a report',
  'wsdot': 'WSDOT Report',
  'another': 'Another Report',
}
const selectedReportType = ref<string>('')
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
