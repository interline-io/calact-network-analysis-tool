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
          />
        </o-field>
      </div>

      <div class="cal-report-download">
        <cal-csv-download
          :data="reportData"
          :disabled="!stopDepartureLoadingComplete"
        />

        <cal-geojson-download
          :data="exportFeatures"
          :disabled="!stopDepartureLoadingComplete"
        />
      </div>
    </div>

    <table v-if="aggregateData.length" class="cal-report-table table is-bordered is-striped">
      <thead v-if="dataDisplayMode === 'Route'">
        <tr class="has-background-grey-dark">
          <th>{{ aggregateOptions[aggregateMode] }}</th>
          <th>number of routes</th>
          <th>average frequency</th>
          <th>fastest frequency</th>
          <th>slowest frequency</th>
        </tr>
      </thead>
      <thead v-else-if="dataDisplayMode === 'Stop'">
        <tr class="has-background-grey-dark">
          <th>{{ aggregateOptions[aggregateMode] }}</th>
          <th>number of stops</th>
          <th>number of routes served</th>
          <th>average visits per day</th>
        </tr>
      </thead>
      <thead v-else-if="dataDisplayMode === 'Agency'">
        <tr class="has-background-grey-dark">
          <th>{{ aggregateOptions[aggregateMode] }}</th>
          <th>number of agencies</th>
          <th>number of routes</th>
          <th>number of stops</th>
        </tr>
      </thead>

      <tbody v-if="dataDisplayMode === 'Route'">
        <tr v-for="result of aggregateData" :key="result.aggregate_name">
          <td>{{ result.aggregate_name }}</td>
          <td>{{ result.aggregate_total }}</td>
          <td>{{ result.average_frequency >= 0 ? Math.round(result.average_frequency / 60) : '-' }}</td>
          <td>{{ result.fastest_frequency >= 0 ? Math.round(result.fastest_frequency / 60) : '-' }}</td>
          <td>{{ result.slowest_frequency >= 0 ? Math.round(result.slowest_frequency / 60) : '-' }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Stop'">
        <tr v-for="result of aggregateData" :key="result.aggregate_name">
          <td>{{ result.aggregate_name }}</td>
          <td>{{ result.aggregate_total }}</td>
          <td>{{ result.number_served }}</td>
          <td>{{ result.visit_count_daily_average >= 0 ? result.visit_count_daily_average : '-' }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Agency'">
        <tr v-for="result of aggregateData" :key="result.aggregate_name">
          <td>{{ result.aggregate_name }}</td>
          <td>{{ result.aggregate_total }}</td>
          <td>{{ result.number_routes }}</td>
          <td>{{ result.number_stops }}</td>
        </tr>
      </tbody>
    </table>

    <div class="cal-report-total block">
      {{ total }} results found
    </div>

    <o-pagination
      v-model:current="current"
      :total="total"
      order="centered"
      :per-page="perPage"
    />

    <table class="cal-report-table table is-bordered is-striped">
      <thead v-if="dataDisplayMode === 'Route'">
        <tr class="has-background-grey-dark">
          <!-- <th>row</th> -->
          <th>route_id</th>
          <th>route_name</th>
          <th>mode</th>
          <th>agency</th>
          <th>average frequency</th>
          <th>fastest frequency</th>
          <th>slowest frequency</th>
        </tr>
      </thead>
      <thead v-else-if="dataDisplayMode === 'Stop'">
        <tr class="has-background-grey-dark">
          <!-- <th>row</th> -->
          <th>stop_id</th>
          <th>stop_name</th>
          <th>mode</th>
          <th>number of routes served</th>
          <th>average visits per day</th>
        </tr>
      </thead>
      <thead v-else-if="dataDisplayMode === 'Agency'">
        <tr class="has-background-grey-dark">
          <!-- <th>row</th> -->
          <th>agency_id</th>
          <th>agency_name</th>
          <th>number of routes</th>
          <th>number of stops</th>
        </tr>
      </thead>

      <tbody v-if="dataDisplayMode === 'Route'">
        <tr v-for="result of reportData.slice(index * perPage, (index + 1) * perPage)" :key="result.id">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.route_id }}</td>
          <td>{{ result.route_name }}</td>
          <td>{{ result.mode }}</td>
          <td>{{ result.agency_name }}</td>
          <td>{{ result.average_frequency >= 0 ? Math.round(result.average_frequency / 60) : '-' }}</td>
          <td>{{ result.fastest_frequency >= 0 ? Math.round(result.fastest_frequency / 60) : '-' }}</td>
          <td>{{ result.slowest_frequency >= 0 ? Math.round(result.slowest_frequency / 60) : '-' }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Stop'">
        <tr v-for="result of reportData.slice(index * perPage, (index + 1) * perPage)" :key="result.id">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.stop_id }}</td>
          <td>{{ result.stop_name }}</td>
          <td>{{ result.modes }}</td>
          <td>{{ result.number_served }}</td>
          <td>{{ result.visit_count_daily_average >= 0 ? result.visit_count_daily_average : '-' }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Agency'">
        <tr v-for="result of reportData.slice(index * perPage, (index + 1) * perPage)" :key="result.id">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.agency_id }}</td>
          <td>{{ result.agency_name }}</td>
          <td>{{ result.number_routes }}</td>
          <td>{{ result.number_stops }}</td>
        </tr>
      </tbody>
    </table>

    <div class="cal-report-footer">
      * results include only stops within the selected bounding box.
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Stop, type StopCsv, stopToStopCsv } from '../stop'
import { type Route, type RouteCsv, routeToRouteCsv } from '../route'
import { type Agency, type AgencyCsv, agencyToAgencyCsv } from '../agency'
import { type Feature } from '../geom'
import { type TableColumn } from './datagrid.vue'
import { geomLayers } from '../constants'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
  agencyFeatures: Agency[]
  exportFeatures: Feature[]
  filterSummary: string[]
  stopDepartureLoadingComplete: boolean
}>()

const current = ref(1)
const index = computed(() => current.value - 1)
const total = computed(() => reportData.value.length)
const perPage = ref(20)
const dataDisplayMode = defineModel<string>('dataDisplayMode')
const aggregateMode = defineModel<string>('aggregateMode')
aggregateMode.value = 'none'

const emit = defineEmits([
  'clickFilterLink'
])

// Copy the geometry layers, and add a 'None' option
const aggregateOptions: Record<string, string> = Object.assign({}, geomLayers)
aggregateOptions.none = 'None'

// TODO: We will get this from `within_features` later.
// For now just make it up, mostly 'Multnomah', handful of others.
const sampleCounties = [
  'Multnomah', 'Multnomah', 'Multnomah', 'Multnomah', 'Multnomah',
  'Clark', 'Clark', 'Columbia', 'Clackamas', 'Washington'
]

// TODO: For when we switch to datagrid
const routeColumns: TableColumn[] = [
  { key: 'route_id', label: 'Route ID', sortable: true },
  { key: 'route_name', label: 'Route Name', sortable: true },
  { key: 'route_mode', label: 'Mode', sortable: true },
  { key: 'route_agency', label: 'Agency', sortable: true },
  { key: 'average_frequency', label: 'Average Frequency', sortable: true },
  { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
  { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
]
const routeColumnsAggregate: TableColumn[] = [
  { key: 'aggregate_name', label: 'Name', sortable: true },
  { key: 'aggregate_total', label: 'Number of Routes', sortable: true },
  { key: 'average_frequency', label: 'Average Frequency', sortable: true },
  { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
  { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
]
const stopColumns: TableColumn[] = [
  { key: 'stop_id', label: 'Stop ID', sortable: true },
  { key: 'stop_name', label: 'Stop Name', sortable: true },
  { key: 'stop_modes', label: 'Modes', sortable: true },
  { key: 'routes_served_count', label: 'Routes Served', sortable: true },
  { key: 'average_visit_count', label: 'Average Visits', sortable: true },
]
const stopColumnsAggregate: TableColumn[] = [
  { key: 'aggregate_name', label: 'Name', sortable: true },
  { key: 'aggregate_total', label: 'Number of Stops', sortable: true },
  { key: 'routes_served_count', label: 'Routes Served', sortable: true },
  { key: 'average_visit_count', label: 'Average Visits', sortable: true },
]
const agencyColumns: TableColumn[] = [
  { key: 'agency_id', label: 'Agency ID', sortable: true },
  { key: 'agency_name', label: 'Agency Name', sortable: true },
  { key: 'number_routes', label: 'Number of Routes', sortable: true },
  { key: 'number_stops', label: 'Number of Stops', sortable: true },
]
const agencyColumnsAggregate: TableColumn[] = [
  { key: 'aggregate_name', label: 'Name', sortable: true },
  { key: 'aggregate_total', label: 'Number of Agencies', sortable: true },
  { key: 'number_routes', label: 'Number of Routes', sortable: true },
  { key: 'number_stops', label: 'Number of Stops', sortable: true },
]

// Each row of report data is just an Object of k-v pairs.
// Could also think of it like Partial<(RouteCsv|StopCsv|AgencyCsv)>, but generic
type RowData = Record<string, any>

const reportData = computed((): RowData[] => {
  // inline reports so they are dependent on the model data
  if (dataDisplayMode.value === 'Route') {
    return props.routeFeatures.filter(s => (s.marked)).map(routeToRouteCsv)
  } else if (dataDisplayMode.value === 'Stop') {
    return props.stopFeatures.filter(s => s.marked).map(stopToStopCsv)
  } else if (dataDisplayMode.value === 'Agency') {
    return props.agencyFeatures.filter(s => s.marked).map(agencyToAgencyCsv)
  }
  return []
})

// Basically does a "group by" operation on the report data by boundary.
const aggregateData = computed((): RowData[] => {
  const groupBy: string = aggregateMode.value
  if (groupBy === 'none') {
    return []
  }

  // Group the report rows by county
  const groupRows: Record<string, RowData[]> = new Map()
  for (let i = 0; i < reportData.value.length; i++) {
    const reportRow = reportData.value[i]
    // TODO: For demo purposes, just assign each report row a county
    const county: string = sampleCounties[i % sampleCounties.length]

    let foundRows: RowData[] = groupRows.get(county)
    if (!foundRows) {
      foundRows = []
      groupRows.set(county, foundRows)
    }
    foundRows.push(Object.assign({}, reportRow)) // copy
  }

  // Aggregate the data
  // TODO, we will need to sum some columns and min/max/avg others?
  const results: RowData[] = []
  for (const [county, rows] of groupRows) {
    const aggregate: RowData = {
      aggregate_name: county,
      aggregate_total: rows.length
    }

    if (dataDisplayMode.value === 'Route') {
      const avgFrequencies: number[] = []
      let fastest = Infinity
      let slowest = -Infinity
      for (const row of rows) {
        if (row.average_frequency >= 0) {
          avgFrequencies.push(row.average_frequency)
        }
        if (row.fastest_frequency >= 0 && row.fastest_frequency < fastest) {
          fastest = row.fastest_frequency
        }
        if (row.slowest_frequency >= 0 && row.slowest_frequency > slowest) {
          slowest = row.slowest_frequency
        }
      }
      aggregate.average_frequency = average(avgFrequencies)
      aggregate.fastest_frequency = Number.isFinite(fastest) ? fastest : -1
      aggregate.slowest_frequency = Number.isFinite(slowest) ? slowest : -1
    } else if (dataDisplayMode.value === 'Stop') {
      const numberServed: number[] = []
      const dailyAverages: number[] = []
      for (const row of rows) {
        if (row.number_served >= 0) {
          numberServed.push(row.number_served)
        }
        if (row.visit_count_daily_average >= 0) {
          dailyAverages.push(row.visit_count_daily_average)
        }
      }
      aggregate.number_served = sum(numberServed)
      aggregate.visit_count_daily_average = average(dailyAverages)
    } else if (dataDisplayMode.value === 'Agency') {
      const numberRoutes: number[] = []
      const numberStops: number[] = []
      for (const row of rows) {
        if (row.number_routes >= 0) {
          numberRoutes.push(row.number_routes)
        }
        if (row.number_stops >= 0) {
          numberStops.push(row.number_stops)
        }
      }
      aggregate.number_routes = sum(numberRoutes)
      aggregate.number_stops = sum(numberStops)
    }

    results.push(aggregate)
  }

  return results

  function average (arr: number[]): number {
    return arr.length > 0 ? (arr.reduce((a, b) => a + b) / arr.length) : -1
  }

  function sum (arr: number[]): number {
    return arr.length > 0 ? (arr.reduce((a, b) => a + b)) : -1
  }
})

// When switching to a different report, return to first page
watch(dataDisplayMode, () => {
  current.value = 1
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

  .cal-report-total {
    font-style: italic;
  }

  .cal-report-table {
    th, td {
      padding: 2px 5px;
    }
    th {
      background-color: #666;
      color: #fff;
    }
  }

  .cal-report-footer {
    font-style: italic;
    text-align: end;
  }

</style>
