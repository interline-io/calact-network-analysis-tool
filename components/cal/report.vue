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

      <div class="report-select">
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

      <cal-csv-download
        :data="reportData"
        :disabled="!stopDepartureLoadingComplete"
      />
    </div>

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
import { type TableColumn } from './datagrid.vue'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
  agencyFeatures: Agency[]
  filterSummary: string[]
  stopDepartureLoadingComplete: boolean
}>()

const current = ref(1)
const index = computed(() => current.value - 1)
const total = computed(() => reportData.value.length)
const perPage = ref(20)
const dataDisplayMode = defineModel<string>('dataDisplayMode')

const emit = defineEmits([
  'clickFilterLink'
])

// TODO: For when we switch to datagrid
const stopColumns: TableColumn[] = [
  { key: 'route_id', label: 'Route ID', sortable: true },
  { key: 'route_name', label: 'Route Name', sortable: true },
  { key: 'route_mode', label: 'Mode', sortable: true },
  { key: 'route_agency', label: 'Agency', sortable: true },
  { key: 'average_frequency', label: 'Average Frequency', sortable: true },
  { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
  { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
]

const routeColumns: TableColumn[] = [
  { key: 'stop_id', label: 'Stop ID', sortable: true },
  { key: 'stop_name', label: 'Stop Name', sortable: true },
  { key: 'stop_modes', label: 'Modes', sortable: true },
  { key: 'routes_served_count', label: 'Routes Served', sortable: true },
  { key: 'average_visit_count', label: 'Average Visits', sortable: true },
]

const agencyColumns: TableColumn[] = [
  { key: 'agency_id', label: 'Agency ID', sortable: true },
  { key: 'agency_name', label: 'Agency Name', sortable: true },
  { key: 'number_routes', label: 'Number of Routes', sortable: true },
  { key: 'number_stops', label: 'Number of Stops', sortable: true },
]

const reportData = computed((): Record<string, any>[] => {
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
        flex: 0 1 60%;
        align-self: stretch;
        background-color: #ddd;
        border: 1px solid #333;
        padding: 5px;
      }

      > .report-select {
        flex: 1 0 0;
        align-self: stretch;
        border: 1px solid #333;
        padding: 5px;
        margin: 0 15px;

        > .which-report {
          font-size: larger;
          font-weight: bold;
        }
      }

      > .download {
        flex: 0 1 10%;
        align-self: center;
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
