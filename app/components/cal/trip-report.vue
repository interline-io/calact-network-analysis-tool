<template>
  <cal-datagrid
    :table-report="tableReport"
    :loading="detailsLoading"
    caption="Trips"
    :filename="filename"
  >
    <template #column-time="{ value }">
      <span class="cal-trip-report-nowrap">{{ shortTime(value) }}</span>
    </template>
    <template #column-route_short_name="{ row }">
      <span
        v-if="routeFor(row)"
        class="cal-trip-report-route"
        :style="routeBadgeStyle(routeFor(row)!)"
        :title="routeTitle(row)"
      >{{ row.route_short_name || row.route_long_name || row.route_id }}</span>
    </template>
    <template #column-headsign="{ value }">
      <span v-if="value">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-trip_start="{ row }">
      <span v-if="row.trip_start" class="cal-trip-report-nowrap">
        {{ shortTime(row.trip_start) }}–{{ shortTime(row.trip_end) }}
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
import {
  tripTableColumns,
  tripTableRows,
  type ScenarioFilterResult,
  type SubjectTrips,
  type TripSubject,
  type TripTableRow,
  type TripTableStop,
} from '~~/src/scenario'
import type { TableReport } from '~~/src/core'
import type { Route, TripDetail } from '~~/src/tl'

const props = defineProps<{
  subject: TripSubject
  trips: SubjectTrips
  title: string
  scenarioFilterResult?: ScenarioFilterResult
  // The scenario's dates scoped to its weekdays, as yyyy-MM-dd.
  scopedDates: string[]
  tripDetails: Map<number, TripDetail>
  detailsLoading: boolean
}>()

const routesById = computed(() => {
  const m = new Map<number, Route>()
  for (const r of props.scenarioFilterResult?.routes || []) {
    m.set(r.id, r)
  }
  return m
})

// Each table row's route, for its badge colors. Kept beside the rows rather
// than in them, since every key of a row goes into the CSV download.
const rowRoutes = new WeakMap<TripTableRow, Route>()

const tableReport = computed((): TableReport => {
  const stops = new Map<number, TripTableStop>()
  for (const s of props.scenarioFilterResult?.stops || []) {
    stops.set(s.id, s)
  }
  const rows = tripTableRows(props.trips.rows, {
    routes: routesById.value,
    stops,
    tripDetails: props.tripDetails,
    scopedDates: props.scopedDates,
  })
  props.trips.rows.forEach((row, i) => {
    const route = routesById.value.get(row.routeId)
    if (route && rows[i]) {
      rowRoutes.set(rows[i], route)
    }
  })
  return {
    columns: tripTableColumns(props.subject.kind, props.scopedDates.length > 1),
    data: rows,
  }
})

const filename = computed(() => `trips-${props.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''))

const placeholder = computed(() => props.detailsLoading ? '…' : '—')

function routeFor (row: Record<string, any>): Route | undefined {
  return rowRoutes.get(row as TripTableRow)
}

function routeTitle (row: Record<string, any>): string {
  return [row.route_long_name, row.agency_name].filter(Boolean).join(' · ')
}

// HH:MM from the row's HH:MM:SS; the CSV keeps the seconds.
function shortTime (value: string): string {
  return value ? value.slice(0, -3) : ''
}

// The route's own colors where the feed gives them, as on the panel.
function routeBadgeStyle (r: Route): Record<string, string> {
  if (!r.route_color) {
    return {}
  }
  return {
    background: `#${r.route_color}`,
    color: r.route_text_color ? `#${r.route_text_color}` : '#fff',
  }
}
</script>

<style scoped lang="scss">
.cal-trip-report-nowrap {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cal-trip-report-route {
  display: inline-block;
  min-width: 1.75em;
  padding: 0 6px;
  border-radius: 3px;
  background: var(--bulma-scheme-main-ter);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
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
