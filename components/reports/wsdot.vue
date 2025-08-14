<template>
  <div class="cal-report">
    <tl-title title="WSDOT Frequent Transit Service Study" />

    <div v-if="loading">
      Loading...
    </div>
    <div v-else-if="config && report">
      <reports-wsdot-viewer
        :report="report"
        :config="config"
      />
    </div>
    <div v-else>
      <strong>Configure report</strong>
      <tl-msg-warning v-if="debugMenu" class="mt-4" style="width:400px" title="Debug menu">
        <o-field label="Preset bounding box">
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

      <o-button variant="primary" @click="runWsdotReport">
        Run Report
      </o-button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useLazyQuery } from '@vue/apollo-composable'
import type { WSDOTReport, WSDOTReportConfig } from '~/src/reports/wsdot'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import { cannedBboxes } from '~/src/constants'
import type { ScenarioData, ScenarioConfig } from '~/src/scenario'
import type { GraphQLClient } from '~/src/graphql'

const loading = ref(false)
const debugMenu = useDebugMenu()
const cannedBbox = ref('portland')
const report = ref<WSDOTReport | null>(null)
const config = ref<WSDOTReportConfig | null>(null)
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')

// Create GraphQL client adapter for Vue Apollo
const createGraphQLClientAdapter = (): GraphQLClient => {
  return {
    async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
      const { load } = useLazyQuery<T>(query, variables, {
        fetchPolicy: 'no-cache',
        clientId: 'transitland'
      })
      const result = await load()
      if (!result) {
        console.log('createGraphQLClientAdapter: no result returned from Apollo query')
        return { data: undefined }
      }
      return { data: result as T }
    }
  }
}

const loadExampleWsdotReport = async () => {
  loading.value = true
  const reportFile = `/examples/${cannedBbox.value}.wsdot.json`
  const data: { config: WSDOTReportConfig, report: WSDOTReport } = await fetch(reportFile)
    .then(res => res.json())
  config.value = data.config
  report.value = data.report
  loading.value = false
}

const runWsdotReport = async () => {
  console.log('runWsdotReport')
  if (!scenarioData.value) {
    console.log('No scenario data loaded!')
    return
  }
  loading.value = true
  const client = createGraphQLClientAdapter()
  const wsdotConfig: WSDOTReportConfig = {
    ...scenarioConfig.value,
    weekdayDate: scenarioConfig.value?.startDate || new Date(),
    weekendDate: scenarioConfig.value?.endDate || new Date(),
    scheduleEnabled: true,
  }
  const wsdotFetcher = new WSDOTReportFetcher(wsdotConfig, scenarioData.value!, client)
  const wsdotReport = await wsdotFetcher.fetch()
  report.value = wsdotReport
  config.value = wsdotConfig
  loading.value = false
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
