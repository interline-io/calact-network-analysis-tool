<template>
  <div class="cal-report">
    <tl-title title="WSDOT Transit Stops and Routes Analysis" />

    <tl-msg-info>
      <h5 class="title is-5">
        About this Analysis
      </h5>
      <p class="mb-3">
        This analysis processes transit data to create unique agency identifiers by prefixing agency_id values with the feed Onestop ID as a namespace.
        It then displays visual tables for transit stops and routes, with the ability to download each as GeoJSON.
      </p>
      <p>
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please go back to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
      </p>
    </tl-msg-info>

    <div v-if="loading">
      Loading...
    </div>
    <div v-else-if="wsdotStopsRoutesReport">
      <analysis-wsdot-stops-routes-viewer
        :report="wsdotStopsRoutesReport"
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
          <p>This analysis will process the loaded scenario data to create unique agency identifiers and display stops and routes information.</p>
        </div>
        <footer class="card-footer">
          <div class="field is-grouped is-grouped-right" style="width: 100%; padding: 0.75rem;">
            <div class="control">
              <o-button variant="outlined" @click="handleCancel">
                Cancel
              </o-button>
            </div>
            <div class="control">
              <o-button variant="primary" :disabled="!scenarioData" :title="!scenarioData ? 'You need to load scenario data before starting this analysis.' : ''" @click="runWsdotStopsRoutesReport">
                Run Report
              </o-button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { WSDOTStopsRoutesReport, WSDOTStopsRoutesReportConfig } from '~/src/reports/wsdot-stops-routes'
import { WSDOTStopsRoutesReportFetcher } from '~/src/reports/wsdot-stops-routes'
import type { ScenarioData, ScenarioConfig } from '~/src/scenario/scenario'
import type { GraphQLClient } from '~/src/graphql'

const loading = ref(false)
const scenarioConfig = defineModel<ScenarioConfig | null>('scenarioConfig')
const scenarioData = defineModel<ScenarioData | null>('scenarioData')
const wsdotStopsRoutesReport = ref<WSDOTStopsRoutesReport | null>(null)

const emit = defineEmits<{
  cancel: []
}>()

// Create GraphQL client adapter for Vue Apollo
const createGraphQLClientAdapter = (): GraphQLClient => {
  return {
    async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
      // For this analysis, we don't need to make additional GraphQL queries
      // All data comes from the scenario data
      return { data: undefined }
    }
  }
}

const runWsdotStopsRoutesReport = async () => {
  console.log('runWsdotStopsRoutesReport')
  if (!scenarioData.value) {
    console.log('No scenario data loaded!')
    return
  }

  loading.value = true
  try {
    const client = createGraphQLClientAdapter()
    const wsdotConfig: WSDOTStopsRoutesReportConfig = {
      ...scenarioConfig.value,
    }
    const wsdotFetcher = new WSDOTStopsRoutesReportFetcher(wsdotConfig, scenarioData.value!, client)
    const wsdotResult = await wsdotFetcher.fetch()
    wsdotStopsRoutesReport.value = wsdotResult

    // Show success toast message
    useToastNotification().showToast(`Analysis completed successfully! Processed ${wsdotResult.stops.length} stops, ${wsdotResult.routes.length} routes, and ${wsdotResult.agencies.length} agencies.`)
  } catch (error) {
    console.error('Error running WSDOT stops and routes analysis:', error)
    // Show error toast message
    useToastNotification().showToast('Error running analysis. Please try again.')
  } finally {
    loading.value = false
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
