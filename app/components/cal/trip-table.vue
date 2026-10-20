<template>
  <table class="cal-trip-table">
    <caption class="is-sr-only">
      Trips
    </caption>
    <!-- A preview: one line per trip, so the first few fit the map sidebar
         without scrolling. Fixed widths; a long value is cut short, with the
         whole of it on hover and in the full table. -->
    <colgroup>
      <col class="cal-trip-table-col-time">
      <col class="cal-trip-table-col-route">
      <col>
      <col class="cal-trip-table-col-trip">
      <col v-if="multiDay" class="cal-trip-table-col-days">
    </colgroup>
    <thead>
      <tr>
        <th scope="col">
          <cat-tooltip :text="tooltip('time')">
            Time
          </cat-tooltip>
        </th>
        <th scope="col">
          Route
        </th>
        <th scope="col">
          Headsign
        </th>
        <th scope="col">
          <cat-tooltip :text="tooltip('trip_start')">
            Trip
          </cat-tooltip>
        </th>
        <th v-if="multiDay" scope="col">
          Days
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(row, i) of rows" :key="i">
        <td class="cal-trip-table-time" :title="subjectKind === 'cluster' ? (row.stop_name || row.stop_id) : undefined">
          {{ tripTimeLabel(row.time) }}
        </td>
        <td>
          <cal-route-badge
            :label="row.route_short_name || row.route_long_name || row.route_id"
            :color="row.route_color"
            :text-color="row.route_text_color"
            :title="row.route_long_name"
            truncate
          />
        </td>
        <td :title="row.headsign || undefined">
          <span v-if="row.headsign">{{ row.headsign }}</span>
          <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
        </td>
        <td class="cal-trip-table-time" :title="row.trip_start ? `${row.stop_count} stops` : undefined">
          <template v-if="row.trip_start">
            {{ tripTimeLabel(row.trip_start) }}–{{ tripTimeLabel(row.trip_end) }}
          </template>
          <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
        </td>
        <td v-if="multiDay" :title="row.days">
          {{ row.days }}
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { tripDetailPlaceholder, tripTableColumns, tripTimeLabel, type TripSubject, type TripTableRow } from '~~/src/scenario'

const props = defineProps<{
  subjectKind: TripSubject['kind']
  rows: TripTableRow[]
  multiDay: boolean
  detailsLoading: boolean
}>()

const placeholder = computed(() => tripDetailPlaceholder(props.detailsLoading))

// The full table's column tooltips, so the two tables explain alike.
const columns = computed(() => tripTableColumns(props.subjectKind, props.multiDay))
function tooltip (key: string): string {
  return columns.value.find(c => c.key === key)?.tooltip ?? ''
}
</script>

<style scoped lang="scss">
.cal-trip-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 12px;

  th, td {
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--bulma-border);
  }

  thead th {
    background: var(--bulma-scheme-main-bis);
    font-weight: 600;
    color: var(--bulma-text-strong);
  }

  td {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.cal-trip-table-col-time {
  width: 14%;
}

.cal-trip-table-col-route {
  width: 18%;
}

.cal-trip-table-col-trip {
  width: 26%;
}

.cal-trip-table-col-days {
  width: 18%;
}

.cal-trip-table-time {
  font-variant-numeric: tabular-nums;
}

.cal-trip-table-pending {
  color: var(--bulma-text-weak);
}
</style>
