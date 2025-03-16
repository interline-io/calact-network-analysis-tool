<template>
  <div class="cal-report">
    <tl-title title="Reports">
      Reports
    </tl-title>

    <div class="cal-report-options">
      <div class="filter-detail">
        Filter detail here (TBD)
      </div>
      <div class="report-select">
        Showing data by:
        <div class="which-report">{{ whichReport }}</div>
        <div><a title="Filter" role="button" @click="emit('clickFilterLink')">(change)</a></div>
      </div>
      <div class="download">
        Download
      </div>
    </div>

    <div class="cal-report-total">
      {{ total }} results found
    </div>

    <o-pagination
      v-model:current="current"
      :total="total"
      order="centered"
      :per-page="perPage"
    />

    <table class="cal-report-table">
    <thead>
      <tr>
        <th>row</th>
        <th>stop_id</th>
        <th>stop_name</th>
        <th>mode</th>
        <th>number of routes served</th>
        <th>average visits per day</th>
      </tr>
    </thead>
    <tbody>
    <tr v-for="result of stopTable" :key="result.stop_id">
      <td>{{ result.row }}</td>
      <td>{{ result.stop_id }}</td>
      <td>{{ result.stop_name }}</td>
      <td>{{ result.modes }}</td>
      <td>{{ result.number_served }}</td>
      <td>{{ result.average_visits }}</td>
      <!-- <td>{{ result.data }}</td> -->
    </tr>
    </tbody>
    </table>

  </div>
</template>


<script setup lang="ts">
import { routeTypes } from '../constants'

const props = defineProps<{
  stopFeatures: Feature[]
}>()

const whichReport = ref<"route" | "stop" | "agency">("stop");
const current = ref(1);
const total = ref(0);
const perPage = ref(20);

const emit = defineEmits([
  'clickFilterLink'
]);


const stopTable = computed(() => {
  // Recalc totals, min/max, note that `current` page is one-based
  total.value = props.stopFeatures.length;
  const index = current.value - 1;
  const min = (index * perPage.value);
  const max = (index * perPage.value) + (perPage.value);

  // Gather results
  const arr = props.stopFeatures || [];
  const results = [];
  for (let i = min; i < max && i < total.value; i++) {
    const stop = arr[i];
    const props = stop.properties;
    const route_stops = props.route_stops || [];

    // gather modes at this stop
    const modes = new Set();
    for (const rstop of route_stops) {
      const rtype = rstop.route.route_type;
      const mode = routeTypes.get(rtype.toString());
      if (mode) {
        modes.add(mode);
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
    });
  }

  return results;
})

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
    margin-bottom:20px;

    > .filter-detail {
      flex: 0 1 60%;
      align-self: stretch;
      background-color: #ddd;
      border: 1px solid #333;
      padding: 5px;
    }

    > .report-select {
      flex: 0 1 25%;
      align-self: stretch;
      border: 1px solid #333;
      padding: 5px;

      > .which-report {
        font-size: larger;
        font-weight: bold;
      }
    }

    > .download {
      flex: 0 1 10%;
      align-self: center;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 5px 15px;
    }
  }

  .cal-report-total {
    margin-bottom: 20px;
    font-style: italic;
  }

  .cal-report-table {
    th, td {
      border: 1px solid #333;
      padding: 2px;
    }
    thead tr {
      background-color: #bbb;
    }

    tbody td {
    }

    tbody tr:nth-child(odd) {
      background-color: #eee;
    }
  }

</style>
