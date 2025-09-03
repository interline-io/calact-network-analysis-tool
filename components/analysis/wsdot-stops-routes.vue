<template>
  <div class="cal-report">
    <tl-title title="WSDOT Transit Stops and Transit Routes" />

    <!-- Overview Section -->
    <tl-msg-info>
      <h4 class="title is-5">
        About this Analysis
      </h4>
      <p class="mb-3">
        This analysis generates statewide GIS layers of Transit Stops and Transit Routes in a standardized format for the Washington State Department of Transportation (WSDOT). Can also be used by other states.
      </p>
      <p>
        This analysis will run against the geographic bounds (bounding box or administrative geographies) already specified. If you want to change the analysis area, please cancel to go back to the <o-icon icon="magnify" style="vertical-align:middle;" /> <strong>Query tab</strong> to modify your geographic bounds.
      </p>
    </tl-msg-info>

    <div v-if="loading">
      Loading...
    </div>
    <div v-else-if="wsdotStopsRoutesConfig && wsdotStopsRoutesReport">
      <!-- Results viewer will go here -->
      <div class="notification is-info">
        TODO: table and GeoJSON download components
      </div>
    </div>
    <div v-else>
      <div class="card">
        <header class="card-header">
          <p class="card-header-title">
            Configure Analysis
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
              <o-button @click="loadExampleStopsRoutes">
                Load example
              </o-button>
            </o-field>
            <br>
          </tl-msg-warning>

          <o-field>
            <template #label>
              <o-tooltip multiline label="The analysis date determines which GTFS schedule data is used for generating the stops and routes GIS layers.">
                Analysis date
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-datepicker v-model="wsdotStopsRoutesConfig.analysisDate" />
          </o-field>

          <o-field>
            <template #label>
              <o-tooltip multiline label="Select the output format for the GIS layers. GeoJSON is currently available, with GeoPackage support coming in the future.">
                Output format
                <o-icon icon="information" />
              </o-tooltip>
            </template>
            <o-select v-model="wsdotStopsRoutesConfig.outputFormat">
              <option value="geojson">
                GeoJSON
              </option>
              <option value="geopackage" disabled>
                GeoPackage (coming soon)
              </option>
            </o-select>
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
              <o-button variant="primary" @click="runStopsRoutesAnalysis">
                Run Analysis
              </o-button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { cannedBboxes } from '~/src/constants'

const loading = ref(false)
const debugMenu = useDebugMenu()
const cannedBbox = ref('portland')
const wsdotStopsRoutesConfig = ref({
  analysisDate: new Date(),
  outputFormat: 'geojson'
})
const wsdotStopsRoutesReport = ref<any>(null)

const emit = defineEmits(['cancel'])

const loadExampleStopsRoutes = async () => {
  loading.value = true
  // Placeholder for loading example data
  console.log('Loading example stops and routes data...')
  loading.value = false
}

const runStopsRoutesAnalysis = async () => {
  console.log('runStopsRoutesAnalysis')
  loading.value = true

  try {
    // TODO: Implement the actual analysis logic
    console.log('Running stops and routes analysis...')

    // Simulate processing time
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Placeholder result
    wsdotStopsRoutesReport.value = {
      status: 'complete',
      message: 'Analysis completed successfully'
    }
  } catch (error) {
    console.error('Error running stops and routes analysis:', error)
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
