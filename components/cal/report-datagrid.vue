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

      <cal-csv-download :data="reportData.data" />
    </div>

    <cal-datagrid v-model:current="current" :table-report="reportData" />

    <div class="cal-report-footer">
      * results include only stops within the selected bounding box.
    </div>
  </div>
</template>

<script setup lang="ts">
import { type TableReport } from './datagrid.vue'
import { type StopCsv, type Stop } from '../stop'
import { type Route, type RouteCsv } from '../route'
import { type Agency, type AgencyCsv } from '../agency'

const props = defineProps<{
  stopFeatures: Stop[]
  routeFeatures: Route[]
}>()

const current = ref(1)
const perPage = 20
const dataDisplayMode = defineModel<string>('dataDisplayMode')

const emit = defineEmits([
  'clickFilterLink'
])

const reportData = computed((): TableReport => {
  if (dataDisplayMode.value === 'Route') {
    return routeReport()
  } else if (dataDisplayMode.value === 'Stop') {
    return stopReport()
  } else if (dataDisplayMode.value === 'Agency') {
    return agencyReport()
  } else {
    return { columns: [], data: [], total: 0, perPage: perPage }
  }
})

// When switching to a different report, return to first page
watch(dataDisplayMode, () => {
  current.value = 1
})

//
// Gather data for route report
//
function routeReport (): TableReport {
  // Recalc totals, min/max, note that `current` page is one-based
  const arr = props.routeFeatures
  const total = arr.length
  const index = current.value - 1
  const min = (index * perPage)
  const max = (index * perPage) + (perPage)

  // Gather results
  const results: RouteCsv[] = []
  for (let i = min; i < max && i < total; i++) {
    const route = arr[i]
    results.push({
      row: i + 1,
      marked: route.marked,
      average_frequency: route.average_frequency,
      fastest_frequency: route.fastest_frequency,
      slowest_frequency: route.slowest_frequency,
      agency_name: route.agency?.agency_name,
      route_name: route.route_name,
      route_mode: route.route_mode,
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

  return {
    total: total,
    perPage: perPage,
    columns: [
      { key: 'route_id', label: 'Route ID', sortable: true },
      { key: 'route_name', label: 'Route Name', sortable: true },
      { key: 'route_mode', label: 'Mode', sortable: true },
      { key: 'route_agency', label: 'Agency', sortable: true },
      { key: 'average_frequency', label: 'Average Frequency', sortable: true },
      { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
      { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
    ],
    data: results,
  }
}

//
// Gather data for stop report
//
function stopReport (): TableReport {
  // Recalc totals, min/max, note that `current` page is one-based
  const arr = props.stopFeatures || []
  const total = arr.length
  const index = current.value - 1
  const min = (index * perPage)
  const max = (index * perPage) + (perPage)

  // Gather results
  const results: StopCsv[] = []
  for (let i = min; i < max && i < total; i++) {
    const stop = arr[i]
    results.push({
      row: i + 1,
      marked: stop.marked,
      routes_served_count: stop.routes_served_count,
      average_visit_count: stop.average_visit_count,
      stop_modes: stop.stop_modes,
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

  return {
    total: total,
    perPage: perPage,
    columns: [
      { key: 'stop_id', label: 'Stop ID', sortable: true },
      { key: 'stop_name', label: 'Stop Name', sortable: true },
      { key: 'stop_modes', label: 'Modes', sortable: true },
      { key: 'routes_served_count', label: 'Routes Served', sortable: true },
      { key: 'average_visit_count', label: 'Average Visits', sortable: true },
    ],
    data: results
  }
}

//
// Gather data for agency report
//
function agencyReport (): TableReport {
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
  const total = arr.length
  const index = current.value - 1
  const min = (index * perPage)
  const max = (index * perPage) + (perPage)

  // Gather results
  const results: AgencyCsv[] = []
  for (let i = min; i < max && i < total; i++) {
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

  return {
    total: total,
    perPage: perPage,
    columns: [
      { key: 'agency_id', label: 'Agency ID', sortable: true },
      { key: 'agency_name', label: 'Agency Name', sortable: true },
      { key: 'number_routes', label: 'Number of Routes', sortable: true },
      { key: 'number_stops', label: 'Number of Stops', sortable: true },
    ], data: results }
}

</script>

<style scoped lang="scss">
  .cal-report {
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    min-width:80vw;
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
