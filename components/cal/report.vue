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
              v-model="whichReport"
              name="whichReport"
              native-value="route"
              label="route"
              @input="changeReport"
            />

            <o-radio
              v-model="whichReport"
              name="whichReport"
              native-value="stop"
              label="stop"
              @input="changeReport"
            />

            <o-radio
              v-model="whichReport"
              name="whichReport"
              native-value="agency"
              label="agency"
              @input="changeReport"
            />
          </o-field>
        </section>

        <div><a title="Filter" role="button" @click="emit('clickFilterLink')">(change)</a></div>
      </div>

      <div class="download button">
        Download
      </div>
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
      <thead v-if="whichReport === 'route'">
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
      <thead v-else-if="whichReport === 'stop'">
        <tr class="has-background-grey-dark">
          <!-- <th>row</th> -->
          <th>stop_id</th>
          <th>stop_name</th>
          <th>mode</th>
          <th>number of routes served</th>
          <th>average visits per day</th>
        </tr>
      </thead>
      <thead v-else-if="whichReport === 'agency'">
        <tr class="has-background-grey-dark">
          <!-- <th>row</th> -->
          <th>agency_id</th>
          <th>agency_name</th>
          <th>number of routes</th>
          <th>number of stops</th>
        </tr>
      </thead>

      <tbody v-if="whichReport === 'route'">
        <tr v-for="result of reportData" :key="result.row">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.route_id }}</td>
          <td>{{ result.route_name }}</td>
          <td>{{ result.mode }}</td>
          <td>{{ result.agency }}</td>
          <td>{{ result.average_frequency }}</td>
          <td>{{ result.fastest_frequency }}</td>
          <td>{{ result.slowest_frequency }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="whichReport === 'stop'">
        <tr v-for="result of reportData" :key="result.row">
          <!-- <td>{{ result.row }}</td> -->
          <td>{{ result.stop_id }}</td>
          <td>{{ result.stop_name }}</td>
          <td>{{ result.modes }}</td>
          <td>{{ result.number_served }}</td>
          <td>{{ result.average_visits }}</td>
        </tr>
      </tbody>
      <tbody v-else-if="whichReport === 'agency'">
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
import { routeTypes } from '../constants'

const props = defineProps<{
  stopFeatures: Feature[]
}>()

const whichReport = ref<'route' | 'stop' | 'agency'>('stop')
const current = ref(1)
const total = ref(0)
const perPage = ref(20)

const emit = defineEmits([
  'clickFilterLink'
])

const reportData = computed(() => {
  if (whichReport.value === 'route') {
    return routeReport()
  } else if (whichReport.value === 'stop') {
    return stopReport()
  } else if (whichReport.value === 'agency') {
    return agencyReport()
  } else {
    total.value = 0
    return []
  }
})

// When switching to a different report, return to first page
function changeReport () {
  current.value = 1
}

//
// Gather data for route report
//
function routeReport () {
  // Collect route data from the stop data.
  const routeData = new Map()
  for (const stop of props.stopFeatures) {
    const props = stop.properties
    const route_stops = props.route_stops || []

    for (const rstop of route_stops) {
      const rid = rstop.route.route_id

      let rdata = routeData.get(rid)
      if (!rdata) { // first time seeing this route
        const rname = rstop.route.route_long_name
        const rtype = rstop.route.route_type
        const mode = routeTypes.get(rtype.toString())
        const aname = rstop.route.agency?.agency_name || ''

        rdata = {
          id: rid,
          name: rname,
          mode: mode,
          agency: aname
        }
        routeData.set(rid, rdata)
      }
    }
  }

  // Recalc totals, min/max, note that `current` page is one-based
  const arr = [...routeData.values()]
  total.value = arr.length
  const index = current.value - 1
  const min = (index * perPage.value)
  const max = (index * perPage.value) + (perPage.value)

  const results = []
  for (let i = min; i < max && i < total.value; i++) {
    const route = arr[i]

    results.push({
      row: i + 1,
      route_id: route.id,
      route_name: route.name,
      mode: route.mode,
      agency: route.agency,
      average_frequency: 'TBD',
      fastest_frequency: 'TBD',
      slowest_frequency: 'TBD',
      data: route
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
  const results = []
  for (let i = min; i < max && i < total.value; i++) {
    const stop = arr[i]
    const props = stop.properties
    const route_stops = props.route_stops || []

    // gather modes at this stop
    const modes = new Set()
    for (const rstop of route_stops) {
      const rtype = rstop.route.route_type
      const mode = routeTypes.get(rtype.toString())
      if (mode) {
        modes.add(mode)
      }
    }

    results.push({
      row: i + 1,
      stop_id: props.stop_id,
      stop_name: props.stop_name,
      modes: [...modes].join(','),
      number_served: route_stops.length,
      average_visits: 'TBD',
      data: stop
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
    const props = stop.properties
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
      agency_id: agency.id,
      agency_name: agency.name,
      number_routes: agency.routes.size,
      number_stops: agency.stops.size,
      data: agency
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
      opacity: 0 !important;
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
