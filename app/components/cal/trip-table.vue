<template>
  <table class="cal-trip-table" :class="{ 'is-compact': compact }">
    <caption class="is-sr-only">
      Trips
    </caption>
    <!-- Compact, in the map sidebar: fixed widths, so long stop names,
         headsigns, and route names wrap or truncate within the panel rather
         than widen it. -->
    <colgroup v-if="compact">
      <col class="cal-trip-table-col-time">
      <col class="cal-trip-table-col-route">
      <col>
      <col class="cal-trip-table-col-trip">
      <col v-if="showDays" class="cal-trip-table-col-days">
    </colgroup>
    <thead>
      <tr>
        <th scope="col">
          <cat-tooltip :text="timeTooltip">
            Time
          </cat-tooltip>
        </th>
        <th v-if="!compact && subject.kind === 'cluster'" scope="col">
          Stop
        </th>
        <th scope="col">
          Route
        </th>
        <th scope="col">
          Headsign
        </th>
        <template v-if="compact">
          <th scope="col">
            <cat-tooltip :text="tripTooltip">
              Trip
            </cat-tooltip>
          </th>
        </template>
        <template v-else>
          <th scope="col">
            Direction
          </th>
          <th scope="col">
            <cat-tooltip text="When the trip leaves its first stop, including stops outside the scenario area.">
              Start
            </cat-tooltip>
          </th>
          <th scope="col">
            <cat-tooltip text="When the trip reaches its last stop, including stops outside the scenario area.">
              End
            </cat-tooltip>
          </th>
          <th scope="col" class="cal-trip-table-num">
            <cat-tooltip text="Stops the whole trip makes, including stops outside the scenario area.">
              Stops
            </cat-tooltip>
          </th>
        </template>
        <th v-if="showDays" scope="col">
          Days
        </th>
        <th v-if="!compact" scope="col">
          Trip ID
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row of rows" :key="row.key">
        <td class="cal-trip-table-time">
          {{ formatGtfsTime(row.time) }}
          <div v-if="compact && subject.kind === 'cluster'" class="cal-trip-table-sub">
            {{ stopName(row.stopId) }}
          </div>
        </td>
        <td v-if="!compact && subject.kind === 'cluster'">
          {{ stopName(row.stopId) }}
        </td>
        <td>
          <template v-if="routesById.get(row.routeId)">
            <span
              class="cal-trip-table-route"
              :class="{ 'is-truncated': compact }"
              :style="routeBadgeStyle(routesById.get(row.routeId)!)"
              :title="routeLabel(routesById.get(row.routeId)!)"
            >{{ routeLabel(routesById.get(row.routeId)!) }}</span>
            <span
              v-if="!compact && routesById.get(row.routeId)!.route_short_name && routesById.get(row.routeId)!.route_long_name"
              class="cal-trip-table-route-long"
            >{{ routesById.get(row.routeId)!.route_long_name }}</span>
          </template>
        </td>
        <td>
          <template v-if="tripDetails.get(row.tripId)">
            {{ tripHeadsignAt(tripDetails.get(row.tripId)!, row.stopId) || `Direction ${row.directionId}` }}
          </template>
          <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
        </td>
        <td v-if="compact" class="cal-trip-table-time">
          <template v-if="tripDetails.get(row.tripId)">
            {{ formatGtfsTime(tripDetails.get(row.tripId)!.startTime) }}–{{ formatGtfsTime(tripDetails.get(row.tripId)!.endTime) }}
            <div class="cal-trip-table-sub">
              {{ tripDetails.get(row.tripId)!.stopCount }} stops
            </div>
          </template>
          <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
        </td>
        <template v-else>
          <td>{{ row.directionId }}</td>
          <td class="cal-trip-table-time">
            <template v-if="tripDetails.get(row.tripId)">
              {{ formatGtfsTime(tripDetails.get(row.tripId)!.startTime) }}
            </template>
            <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
          </td>
          <td class="cal-trip-table-time">
            <template v-if="tripDetails.get(row.tripId)">
              {{ formatGtfsTime(tripDetails.get(row.tripId)!.endTime) }}
            </template>
            <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
          </td>
          <td class="cal-trip-table-num">
            <template v-if="tripDetails.get(row.tripId)">
              {{ tripDetails.get(row.tripId)!.stopCount }}
            </template>
            <span v-else class="cal-trip-table-pending">{{ placeholder }}</span>
          </td>
        </template>
        <td v-if="showDays">
          {{ describeRowDays(row.dates, scopedDates) }}
        </td>
        <td v-if="!compact" class="cal-trip-table-id">
          {{ tripDetails.get(row.tripId)?.tripId ?? '' }}
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { describeRowDays, type ScenarioFilterResult, type SubjectTripRow, type TripSubject } from '~~/src/scenario'
import { formatGtfsTime } from '~~/src/core'
import { tripHeadsignAt, type Route, type TripDetail } from '~~/src/tl'

const props = defineProps<{
  subject: TripSubject
  rows: SubjectTripRow[]
  scenarioFilterResult?: ScenarioFilterResult
  // The scenario's dates scoped to its weekdays, as yyyy-MM-dd.
  scopedDates: string[]
  tripDetails: Map<number, TripDetail>
  detailsLoading: boolean
  // The map sidebar's narrow form; the modal shows every column.
  compact?: boolean
}>()

const showDays = computed(() => props.scopedDates.length > 1)

const placeholder = computed(() => props.detailsLoading ? '…' : '—')

const routesById = computed(() => {
  const m = new Map<number, Route>()
  for (const r of props.scenarioFilterResult?.routes || []) {
    m.set(r.id, r)
  }
  return m
})

const stopsById = computed(() => {
  const m = new Map<number, { stop_name?: string, stop_id: string }>()
  for (const s of props.scenarioFilterResult?.stops || []) {
    m.set(s.id, s)
  }
  return m
})

function stopName (id: number): string {
  const s = stopsById.value.get(id)
  return s?.stop_name || s?.stop_id || String(id)
}

function routeLabel (r: Route): string {
  return r.route_short_name || r.route_long_name || r.route_id
}

// The route's own colors where the feed gives them, as www's route chips are
// drawn; a neutral badge otherwise.
function routeBadgeStyle (r: Route): Record<string, string> {
  if (!r.route_color) {
    return {}
  }
  return {
    background: `#${r.route_color}`,
    color: r.route_text_color ? `#${r.route_text_color}` : '#fff',
  }
}

const timeTooltip = computed(() => {
  if (props.subject.kind === 'route') {
    return 'When the trip leaves its first stop within the scenario area.'
  }
  return 'When the trip leaves this stop.'
})

const tripTooltip = 'When the trip leaves its first stop and reaches its last, and how many stops it makes, including stops outside the scenario area.'
</script>

<style scoped lang="scss">
.cal-trip-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th, td {
    padding: 4px 8px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid var(--bulma-border);
  }

  thead th {
    background: var(--bulma-scheme-main-bis);
    font-weight: 600;
    color: var(--bulma-text-strong);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  &.is-compact {
    table-layout: fixed;
    font-size: 12px;

    th, td {
      padding: 4px 6px;
    }

    td {
      overflow-wrap: break-word;
    }
  }
}

.cal-trip-table-col-time {
  width: 17%;
}

.cal-trip-table-col-route {
  width: 23%;
}

.cal-trip-table-col-trip {
  width: 22%;
}

.cal-trip-table-col-days {
  width: 15%;
}

.cal-trip-table-num {
  font-variant-numeric: tabular-nums;
  text-align: right !important;
  white-space: nowrap;
}

.cal-trip-table-time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cal-trip-table-id {
  font-family: var(--bulma-family-code);
  font-size: 12px;
  color: var(--bulma-text-weak);
}

.cal-trip-table-sub {
  font-size: 11px;
  color: var(--bulma-text-weak);
  white-space: normal;
}

.cal-trip-table-route {
  display: inline-block;
  min-width: 1.75em;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bulma-scheme-main-ter);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;

  // In the sidebar a long name (an intercity route with no short name) would
  // push the table past the panel's width.
  &.is-truncated {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }
}

.cal-trip-table-route-long {
  margin-left: 6px;
}

.cal-trip-table-pending {
  color: var(--bulma-text-weak);
}
</style>
