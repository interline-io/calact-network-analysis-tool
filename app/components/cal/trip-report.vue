<template>
  <cal-datagrid
    :table-report="tableReport"
    :loading="detailsLoading"
    caption="Trips"
    :filename="`trips-${title}`"
  >
    <template #column-time="{ value }">
      <span class="cal-trip-report-nowrap">{{ hhmm(value) }}</span>
    </template>
    <template #column-route_short_name="{ row }">
      <cal-route-badge
        :label="row.route_short_name || row.route_long_name || row.route_id"
        :color="row.route_color"
        :text-color="row.route_text_color"
        :title="[row.route_long_name, row.agency_name].filter(Boolean).join(' · ')"
      />
    </template>
    <template #column-headsign="{ value }">
      <span v-if="value">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-trip_start="{ row }">
      <span v-if="row.trip_start" class="cal-trip-report-nowrap">
        {{ hhmm(row.trip_start) }}–{{ hhmm(row.trip_end) }}
      </span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-stop_count="{ value }">
      <span v-if="value !== ''">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-days="{ value }">
      <span class="cal-trip-report-nowrap">{{ value }}</span>
    </template>
    <template #column-trip_id="{ value }">
      <span v-if="value" class="cal-trip-report-id" :title="value">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
  </cal-datagrid>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { tripTableColumns, type TripSubject, type TripTableRow } from '~~/src/scenario'
import { formatGtfsTime, parseHMS, type TableReport } from '~~/src/core'

const props = defineProps<{
  subjectKind: TripSubject['kind']
  rows: TripTableRow[]
  multiDay: boolean
  // What the trips are for, as the download's file name.
  title: string
  detailsLoading: boolean
}>()

const tableReport = computed((): TableReport => ({
  columns: tripTableColumns(props.subjectKind, props.multiDay),
  data: props.rows,
}))

const placeholder = computed(() => props.detailsLoading ? '…' : '—')

// HH:MM from a row's HH:MM:SS; the CSV keeps the seconds.
function hhmm (value: string): string {
  return formatGtfsTime(parseHMS(value))
}
</script>

<style scoped lang="scss">
.cal-trip-report-nowrap {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

// A trip_id can run to a sentence in some feeds; the full id is on hover and
// in the CSV.
.cal-trip-report-id {
  display: inline-block;
  max-width: 14em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-family: var(--bulma-family-code);
  font-size: 12px;
  color: var(--bulma-text-weak);
}

.cal-trip-report-pending {
  color: var(--bulma-text-weak);
}
</style>
