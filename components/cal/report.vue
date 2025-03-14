<template>
  <div class="cal-report">
    <tl-title title="Reports">
      Reports
    </tl-title>

    <table class="cal-report-table">
    <thead>
      <tr>
        <th>stop_id</th>
        <th>stop_name</th>
        <th>mode</th>
        <th>number of routes served</th>
        <th>average visits per day</th>
      </tr>
    </thead>
    <tbody>
    <tr v-for="row of stopTable" :key="row.stop_id">
      <td>{{ row.stop_id }}</td>
      <td>{{ row.stop_name }}</td>
      <td>{{ row.modes }}</td>
      <td>{{ row.number_served }}</td>
      <td>{{ row.average_visits }}</td>
      <!--<td>{{ row.data }}</td>-->
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


const stopTable = computed(() => {
  const rows = [];
  for (const stop of props.stopFeatures) {
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

    rows.push({
      stop_id: props.stop_id,
      stop_name: props.stop_name,
      modes: [...modes].join(','),
      number_served: route_stops.length,
      average_visits: 'TBD',
      data: stop
    });
  }
  return rows;
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
