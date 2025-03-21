<template>
  <div class="cal-report">
    <tl-title title="Reports">
      Reports
    </tl-title>

    <div class="cal-report-options block">
      <div class="filter-detail">
        Filter detail here (TBD)
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

      <cal-csv-download :data="reportData" />
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
        <tr v-for="result of reportData" :key="result.row">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.route_id }}</td>
          <td>{{ result.route_name }}</td>
          <td>{{ result.mode }}</td>
          <td>{{ result.agency_name }}</td>
          <td>{{ result.average_frequency }}</td>
          <td>{{ result.fastest_frequency }}</td>
          <td>{{ result.slowest_frequency }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Stop'">
        <tr v-for="result of reportData" :key="result.row">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.stop_id }}</td>
          <td>{{ result.stop_name }}</td>
          <td>{{ result.modes }}</td>
          <td>{{ result.number_served }}</td>
          <td>{{ result.average_visits }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="dataDisplayMode === 'Agency'">
        <tr v-for="result of reportData" :key="result.row">
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
import { type Stop, type StopCsv } from '../stop'
import { type Route, type RouteCsv } from '../route'
import { type Agency, type AgencyCsv } from '../agency'
import { type TableColumn } from './datagrid.vue'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
}>()

const current = ref(1)
const total = ref(0)
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
  if (dataDisplayMode.value === 'Route') {
    return routeReport()
  } else if (dataDisplayMode.value === 'Stop') {
    return stopReport()
  } else if (dataDisplayMode.value === 'Agency') {
    return agencyReport()
  } else {
    total.value = 0
    return []
  }
})

// When switching to a different report, return to first page
watch(dataDisplayMode, () => {
  current.value = 1
})

//
// Gather data for route report
//
function routeReport () {
  // Recalc totals, min/max, note that `current` page is one-based
  const arr = props.routeFeatures || []
  total.value = arr.length
  const index = current.value - 1
  const min = (index * perPage.value)
  const max = (index * perPage.value) + (perPage.value)

  const results: RouteCsv[] = []
  for (let i = min; i < max && i < total.value; i++) {
    const route = arr[i]
    results.push({
      row: i + 1,
      marked: route.marked,
      average_frequency: route.average_frequency,
      fastest_frequency: route.fastest_frequency,
      slowest_frequency: route.slowest_frequency,
      agency_name: route.agency_name,
      mode: route.mode,
      route_name: route.route_name,
      // GTFS properties
      route_id: route.route_id,
      route_agency: route.route_agency,
      route_long_name: route.route_long_name,
      route_short_name: route.route_short_name,
      route_type: route.route_type,
      route_color: route.route_color,
      route_text_color: route.route_text_color,
      route_url: route.route_url,
      route_desc: route.route_desc,
      route_sort_order: route.route_sort_order,
      continuous_drop_off: route.continuous_drop_off,
      continuous_pickup: route.continuous_pickup,
    })
  }
  return results
}

//
// Gather data for stop report
//
function stopReport () {
  // Recalc totals, min/max, note that `current` page is one-based
  const arr = props.stopFeatures || []
  total.value = arr.length
  const index = current.value - 1
  const min = (index * perPage.value)
  const max = (index * perPage.value) + (perPage.value)

  // Gather results
  const results: StopCsv[] = []
  for (let i = min; i < max && i < total.value; i++) {
    const stop = arr[i]
    results.push({
      row: i + 1,
      marked: stop.marked,
      number_served: stop.number_served,
      average_visits: stop.average_visits,
      modes: stop.modes,
      // GTFS properties
      location_type: stop.location_type,
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_desc: stop.stop_desc,
      stop_timezone: stop.stop_timezone,
      stop_url: stop.stop_url,
      zone_id: stop.zone_id,
      wheelchair_boarding: stop.wheelchair_boarding,
      platform_code: stop.platform_code,
      tts_stop_name: stop.tts_stop_name,
    })
  }
  return results
}

//
// Gather data for agency report
//
function agencyReport () {
  // Collect agency data from the stop data.
  const agencyData = new Map()
  for (const stop of props.stopFeatures) {
    const props = stop
    const route_stops = props.route_stops || []

    for (const rstop of route_stops) {
      const rid = rstop.route.route_id
      const aid = rstop.route.agency?.agency_id
      const aname = rstop.route.agency?.agency_name
      if (!aid || !aname) continue // no valid agency listed for this stop?

      let adata = agencyData.get(aid)
      if (!adata) { // first time seeing this agency
        adata = {
          id: aid,
          name: aname,
          routes: new Set(),
          stops: new Set()
        }
        agencyData.set(aid, adata)
      }
      adata.routes.add(rid)
      adata.stops.add(props.stop_id)
    }
  }

  // Recalc totals, min/max, note that `current` page is one-based
  const arr = [...agencyData.values()]
  total.value = arr.length
  const index = current.value - 1
  const min = (index * perPage.value)
  const max = (index * perPage.value) + (perPage.value)

  const results = []
  for (let i = min; i < max && i < total.value; i++) {
    const agency = arr[i]
    results.push({
      row: i + 1,
      number_routes: agency.routes.size,
      number_stops: agency.stops.size,
      marked: agency.marked,
      // GTFs properties
      agency_id: agency.id,
      agency_name: agency.name,
      agency_email: agency.agency_email,
      agency_fare_url: agency.agency_fare_url,
      agency_lang: agency.agency_lang,
      agency_phone: agency.agency_phone,
      agency_timezone: agency.agency_timezone,
    })
  }

  return results
}

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
