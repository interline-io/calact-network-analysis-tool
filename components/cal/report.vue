<template>
  <div class="cal-report">
    <tl-title title="Reports">
      Reports
    </tl-title>

    <div class="cal-report-options block">
      <div class="filter-detail">
        <div v-if="dataDisplayMode === 'Agency'">
          Showing agencies:
        </div>
        <div v-if="dataDisplayMode === 'Route'">
          Showing routes:
        </div>
        <div v-if="dataDisplayMode === 'Stop'">
          Showing stops:
        </div>

        <ul style="list-style: disc inside">
          <li v-for="item of filterSummary" :key="item">
            {{ item }}
          </li>
        </ul>
      </div>

      <div class="cal-report-option-section">
        Showing data by:
        <section>
          <o-field>
            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Route"
              label="Route"
            />

            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Stop"
              label="Stop"
            />

            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Agency"
              label="Agency"
            />
          </o-field>
        </section>

        <div><a title="Filter" role="button" @click="emit('clickFilterLink')">(change)</a></div>
      </div>

      <div class="cal-report-option-section">
        Aggregate data by:
        <br>
        <br>
        <o-field>
          <o-select
            v-model="aggregateMode"
            :options="aggregateOptions"
            :disabled="!(dataDisplayMode === 'Stop')"
          />
        </o-field>
      </div>

      <div class="cal-report-download">
        <cal-geojson-download
          :data="exportFeatures"
          :disabled="!stopDepartureLoadingComplete"
        />
      </div>
    </div>

    <div v-if="geoReportData.columns.length > 0">
      <cal-datagrid
        :table-report="geoReportData"
        :loading="!stopDepartureLoadingComplete"
      />
      <hr>
    </div>

    <cal-datagrid
      :table-report="reportData"
      :loading="!stopDepartureLoadingComplete"
    />
  </div>
</template>

<script setup lang="ts">
import { type Stop, type StopCsv, stopToStopCsv, stopGeoAggregateCsv } from '../stop'
import { type Route, type RouteCsv, routeToRouteCsv } from '../route'
import { type Agency, type AgencyCsv, agencyToAgencyCsv } from '../agency'
import { type Feature } from '../geom'
import { type TableReport, type TableColumn } from './datagrid.vue'
import { geomLayers } from '../constants'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
  agencyFeatures: Agency[]
  exportFeatures: Feature[]
  filterSummary: string[]
  stopDepartureLoadingComplete: boolean
}>()

const dataDisplayMode = defineModel<string>('dataDisplayMode', { default: 'Stop' })
const aggregateMode = defineModel<string>('aggregateMode', { default: '' })

const emit = defineEmits([
  'clickFilterLink'
])

// Copy the geometry layers, and add a 'None' option
const aggregateOptions: Record<string, string> = Object.assign({ none: 'None' }, geomLayers)

// TODO: For when we switch to datagrid
const routeColumns: TableColumn[] = [
  { key: 'route_id', label: 'Route ID', sortable: true },
  { key: 'route_name', label: 'Route Name', sortable: true },
  { key: 'route_mode', label: 'Mode', sortable: true },
  { key: 'agency_name', label: 'Agency', sortable: true },
  { key: 'average_frequency', label: 'Average Frequency', sortable: true },
  { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
  { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
]

// const routeColumnsAggregate: TableColumn[] = [
//   { key: 'aggregate_name', label: 'Name', sortable: true },
//   { key: 'aggregate_total', label: 'Number of Routes', sortable: true },
//   { key: 'average_frequency', label: 'Average Frequency', sortable: true },
//   { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
//   { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
// ]

const stopColumns: TableColumn[] = [
  { key: 'stop_id', label: 'Stop ID', sortable: true },
  { key: 'stop_name', label: 'Stop Name', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'routes_count', label: 'Routes Served', sortable: true },
  { key: 'agencies_count', label: 'Agencies Served', sortable: true },
  { key: 'visit_count_daily_average', label: 'Average Visits', sortable: true },
]
const stopGeoAggregateColumns: TableColumn[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'stops_count', label: 'Number of Stops', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'routes_count', label: 'Routes Served', sortable: true },
  { key: 'agencies_count', label: 'Agencies Served', sortable: true },
  { key: 'visit_count_daily_average', label: 'Average Visits', sortable: true },
]
const agencyColumns: TableColumn[] = [
  { key: 'agency_id', label: 'Agency ID', sortable: true },
  { key: 'agency_name', label: 'Agency Name', sortable: true },
  { key: 'routes_count', label: 'Number of Routes', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'stops_count', label: 'Number of Stops', sortable: true },
]

// const agencyColumnsAggregate: TableColumn[] = [
//   { key: 'aggregate_name', label: 'Name', sortable: true },
//   { key: 'aggregate_total', label: 'Number of Agencies', sortable: true },
//   { key: 'number_routes', label: 'Number of Routes', sortable: true },
//   { key: 'number_stops', label: 'Number of Stops', sortable: true },
// ]

const geoReportData = computed((): TableReport => {
  if (aggregateMode.value === '' || aggregateMode.value === 'none') {
    return { data: [], columns: [] }
  }
  // Handle aggregation
  if (dataDisplayMode.value === 'Stop') {
    return {
      data: stopGeoAggregateCsv(props.stopFeatures.filter(s => (s.marked)), aggregateMode.value),
      columns: stopGeoAggregateColumns
    }
  }
  return { data: [], columns: [] }
})

const reportData = computed((): TableReport => {
  // Non-aggregated data
  if (dataDisplayMode.value === 'Route') {
    return {
      data: props.routeFeatures.filter(s => (s.marked)).map(routeToRouteCsv),
      columns: routeColumns
    }
  } else if (dataDisplayMode.value === 'Stop') {
    return {
      data: props.stopFeatures.filter(s => s.marked).map(stopToStopCsv), columns:
         stopColumns
    }
  } else if (dataDisplayMode.value === 'Agency') {
    return {
      data: props.agencyFeatures.filter(s => s.marked).map(agencyToAgencyCsv),
      columns: agencyColumns
    }
  }
  return { data: [], columns: [] }
})

</script>

<style scoped lang="scss">
  .cal-report {
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    width: calc(100vw - 100px);
    padding-left:20px;
    padding-right:20px;
    > .cal-body {
      > div, > article {
        margin-bottom:10px;
      }
    }
  }

  .cal-report-options {
    display: flex;
    flex: 0;
    flex-flow: row nowrap;
    justify-content: space-between;

    > .filter-detail {
      flex: 1 1 25%;
      align-self: stretch;
      background-color: #ddd;
      border: 1px solid #333;
      padding: 5px;
    }

    > .cal-report-option-section {
      flex: 1;
      align-self: stretch;
      border: 1px solid #333;
      padding: 5px;
      margin-left: 15px;

      > .which-report {
        font-size: larger;
        font-weight: bold;
      }
    }

    > .cal-report-download {
      flex: 1;
      display: flex;
      align-self: center;
      flex-flow: column nowrap;
      margin-left: 15px;
    }
  }
</style>
