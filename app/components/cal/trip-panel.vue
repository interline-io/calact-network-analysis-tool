<template>
  <div v-if="subject && trips" class="cal-trip-panel">
    <cat-msg
      :title="`Trips for: ${title}`"
      expandable
      closable
      :open="true"
      variant="dark"
      @close="$emit('close')"
    >
      <cat-tabs v-model="activeTab" type="boxed" size="small">
        <cat-tab-item value="overview" label="Overview">
          <p v-if="trips.count === 0" class="cal-trip-panel-empty">
            No trips within the current filters.
          </p>
          <table v-else class="cal-trip-panel-table cal-trip-panel-overview">
            <caption class="is-sr-only">
              Trip overview
            </caption>
            <tbody>
              <tr v-if="subject.kind === 'cluster'">
                <th scope="row">
                  Stops
                </th>
                <td>{{ subject.stopIds.length }}</td>
              </tr>
              <tr>
                <th scope="row">
                  <cat-tooltip :text="countTooltip">
                    Total trips
                    <cat-icon size="small" icon="information" />
                  </cat-tooltip>
                </th>
                <td>{{ trips.count.toLocaleString() }}</td>
              </tr>
              <tr v-if="trips.dateCount > 1">
                <th scope="row">
                  Trips per day
                </th>
                <td>{{ formatAverage(trips.count / trips.dateCount) }}</td>
              </tr>
              <tr v-if="subject.kind !== 'route'">
                <th scope="row">
                  Routes
                </th>
                <td>{{ trips.routeCounts.length }}</td>
              </tr>
              <tr v-if="frequencyText">
                <th scope="row">
                  <cat-tooltip :text="frequencyTooltip">
                    Scheduled frequency
                    <cat-icon size="small" icon="information" />
                  </cat-tooltip>
                </th>
                <td>{{ frequencyText }}</td>
              </tr>
              <tr>
                <th scope="row">
                  {{ subject.kind === 'route' ? 'First / last trip' : 'First / last departure' }}
                </th>
                <td>{{ formatGtfsTime(trips.firstTime) }} – {{ formatGtfsTime(trips.lastTime) }}</td>
              </tr>
            </tbody>
          </table>

          <table v-if="breakdown.length" class="cal-trip-panel-table cal-trip-panel-breakdown">
            <caption class="is-sr-only">
              {{ subject.kind === 'route' ? 'Trips by direction' : 'Trips by route' }}
            </caption>
            <thead>
              <tr>
                <th scope="col">
                  {{ subject.kind === 'route' ? 'Direction' : 'Route' }}
                </th>
                <th scope="col" class="cal-trip-panel-num">
                  Trips
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="b of breakdown" :key="b.key">
                <td>
                  <span
                    v-if="b.route"
                    class="cal-trip-panel-route"
                    :style="routeBadgeStyle(b.route)"
                  >{{ routeLabel(b.route) }}</span>
                  <span v-if="b.route && b.route.route_long_name && b.route.route_short_name" class="cal-trip-panel-route-long">
                    {{ b.route.route_long_name }}
                  </span>
                  <template v-if="!b.route">
                    {{ b.label }}
                  </template>
                </td>
                <td class="cal-trip-panel-num">
                  {{ b.count.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </cat-tab-item>

        <cat-tab-item value="trips" label="Trips">
          <p v-if="trips.rows.length === 0" class="cal-trip-panel-empty">
            No trips within the current filters.
          </p>
          <template v-else>
            <p v-if="detailsError" class="cal-trip-panel-error">
              Could not load trip details: {{ detailsError }}
              <button type="button" class="cal-trip-panel-link" @click="$emit('loadDetails')">
                Retry
              </button>
            </p>
            <div class="cal-trip-panel-scroll">
              <table class="cal-trip-panel-table cal-trip-panel-trips">
                <caption class="is-sr-only">
                  Trips
                </caption>
                <thead>
                  <tr>
                    <th scope="col">
                      <cat-tooltip :text="timeTooltip">
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
                      <cat-tooltip text="When the trip leaves its first stop and reaches its last, including stops outside the scenario area.">
                        Trip
                      </cat-tooltip>
                    </th>
                    <th scope="col" class="cal-trip-panel-num">
                      <cat-tooltip text="Stops the whole trip makes, including stops outside the scenario area.">
                        Stops
                      </cat-tooltip>
                    </th>
                    <th v-if="scopedDates.length > 1" scope="col">
                      Days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row of visibleRows" :key="row.key">
                    <td class="cal-trip-panel-time">
                      {{ formatGtfsTime(row.time) }}
                      <div v-if="subject.kind === 'cluster'" class="cal-trip-panel-sub">
                        {{ stopName(row.stopId) }}
                      </div>
                    </td>
                    <td>
                      <span
                        v-if="routesById.get(row.routeId)"
                        class="cal-trip-panel-route"
                        :style="routeBadgeStyle(routesById.get(row.routeId)!)"
                      >{{ routeLabel(routesById.get(row.routeId)!) }}</span>
                    </td>
                    <td>
                      <template v-if="tripDetails.get(row.tripId)">
                        {{ tripDetails.get(row.tripId)!.headsign || `Direction ${row.directionId}` }}
                      </template>
                      <span v-else class="cal-trip-panel-pending">{{ detailsPlaceholder }}</span>
                    </td>
                    <td class="cal-trip-panel-time">
                      <template v-if="tripDetails.get(row.tripId)">
                        {{ formatGtfsTime(tripDetails.get(row.tripId)!.startTime) }}–{{ formatGtfsTime(tripDetails.get(row.tripId)!.endTime) }}
                      </template>
                      <span v-else class="cal-trip-panel-pending">{{ detailsPlaceholder }}</span>
                    </td>
                    <td class="cal-trip-panel-num">
                      <template v-if="tripDetails.get(row.tripId)">
                        {{ tripDetails.get(row.tripId)!.stopCount }}
                      </template>
                      <span v-else class="cal-trip-panel-pending">{{ detailsPlaceholder }}</span>
                    </td>
                    <td v-if="scopedDates.length > 1">
                      {{ describeRowDays(row.dates, scopedDates) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-if="trips.rows.length > visibleRows.length" class="cal-trip-panel-more">
              Showing {{ visibleRows.length }} of {{ trips.rows.length }} trips.
              <button type="button" class="cal-trip-panel-link" @click="showAll = true">
                Show all
              </button>
            </div>
          </template>
        </cat-tab-item>
      </cat-tabs>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { describeRowDays, type ScenarioFilterResult, type SubjectTrips, type TripSubject } from '~~/src/scenario'
import { formatDuration, formatGtfsTime } from '~~/src/core'
import type { Route, TripDetail } from '~~/src/tl'

const props = defineProps<{
  subject?: TripSubject
  trips?: SubjectTrips
  scenarioFilterResult?: ScenarioFilterResult
  // The scenario's dates scoped to its weekdays, as yyyy-MM-dd.
  scopedDates: string[]
  tripDetails: Map<number, TripDetail>
  detailsLoading: boolean
  detailsError: string | null
}>()

const emit = defineEmits<{
  close: []
  loadDetails: []
}>()

type TripPanelTab = 'overview' | 'trips'
const activeTab = ref<TripPanelTab>('overview')

// The table renders this many rows until asked for the rest, as a long day at
// a busy stop runs to hundreds.
const ROW_LIMIT = 100
const showAll = ref(false)

// Details are fetched only once the Trips tab is open, for whatever subject it
// shows.
watch(
  [activeTab, () => props.trips],
  ([tab]) => {
    if (tab === 'trips') {
      emit('loadDetails')
    }
  },
)

watch(() => props.subject, () => {
  showAll.value = false
})

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

const subjectRoute = computed(() => {
  const s = props.subject
  return s?.kind === 'route' ? routesById.value.get(s.routeId) : undefined
})

const title = computed(() => {
  const s = props.subject
  if (!s) {
    return ''
  }
  if (s.kind === 'stop') {
    return stopName(s.stopId)
  }
  if (s.kind === 'cluster') {
    const cluster = props.scenarioFilterResult?.stopClusters?.find(c => c.id === s.clusterId)
    return `Stop cluster at ${stopName(cluster?.anchorStopId ?? s.stopIds[0] ?? 0)}`
  }
  const r = subjectRoute.value
  if (!r) {
    return 'Route'
  }
  return [r.route_short_name, r.route_long_name].filter(Boolean).join(' ')
})

const countTooltip = computed(() => {
  if (props.subject?.kind === 'route') {
    return 'Trips with any departure in the scenario area during the days and times within the current filters, as the Routes report counts them.'
  }
  return 'Visits at the stop by any route during the days and times within the current filters, as the Stops report\'s Total Visits counts them. A trip that calls twice counts twice.'
})

const timeTooltip = computed(() => {
  if (props.subject?.kind === 'route') {
    return 'When the trip leaves its first stop within the scenario area.'
  }
  return 'When the trip leaves this stop.'
})

const frequencyText = computed(() => {
  if (props.subject?.kind === 'route') {
    const f = subjectRoute.value?.average_frequency
    return f != null ? `Every ${formatDuration(f)}` : ''
  }
  const perHour = props.trips?.averagePerHour
  if (!perHour) {
    return ''
  }
  // To the minute, as seconds would claim more precision than an average has,
  // unless trips come more than once a minute.
  const secs = 3600 / perHour
  return `Every ${formatDuration(secs >= 60 ? Math.round(secs / 60) * 60 : Math.round(secs))}`
})

const frequencyTooltip = computed(() => {
  if (props.subject?.kind === 'route') {
    return 'The route\'s average time between trips in its busier direction, as the Routes report gives it.'
  }
  return 'The average time between trips across every route and direction here, over the hours and days within the current filters.'
})

interface BreakdownRow {
  key: string
  label: string
  route?: Route
  count: number
}

// Trips by route for a stop or cluster; by direction for a route.
const breakdown = computed<BreakdownRow[]>(() => {
  const t = props.trips
  const s = props.subject
  if (!t || !s || t.count === 0) {
    return []
  }
  if (s.kind !== 'route') {
    return t.routeCounts.map(rc => ({
      key: String(rc.routeId),
      label: String(rc.routeId),
      route: routesById.value.get(rc.routeId),
      count: rc.count,
    }))
  }
  const byDir = new Map<number, number>()
  for (const row of t.rows) {
    byDir.set(row.directionId, (byDir.get(row.directionId) || 0) + row.dates.length)
  }
  return [...byDir]
    .sort((a, b) => a[0] - b[0])
    .map(([dir, count]) => ({ key: `dir-${dir}`, label: directionLabel(dir), count }))
})

// A direction by its most common headsign once trip details are in, as www
// names directions; by its GTFS direction_id until then.
function directionLabel (dir: number): string {
  const counts = new Map<string, number>()
  for (const row of props.trips?.rows || []) {
    const h = row.directionId === dir ? props.tripDetails.get(row.tripId)?.headsign : undefined
    if (h) {
      counts.set(h, (counts.get(h) || 0) + row.dates.length)
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0]
  return top ? `To ${top[0]}` : `Direction ${dir}`
}

const visibleRows = computed(() => {
  const rows = props.trips?.rows || []
  return showAll.value ? rows : rows.slice(0, ROW_LIMIT)
})

const detailsPlaceholder = computed(() => props.detailsLoading ? '…' : '—')

function formatAverage (n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
</script>

<style scoped lang="scss">
.cal-trip-panel {
  color: black;
}

.cal-trip-panel :deep(.message-body) {
  padding: 8px 10px;
}

.cal-trip-panel :deep(.tabs) {
  margin-bottom: 8px;
}

.cal-trip-panel-table {
  width: 100%;
  border-collapse: collapse;
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
    position: sticky;
    top: 0;
    z-index: 1;
  }
}

.cal-trip-panel-overview th {
  font-weight: 600;
  width: 55%;
}

.cal-trip-panel-breakdown {
  margin-top: 10px;
}

.cal-trip-panel-scroll {
  max-height: 320px;
  overflow-y: auto;
}

.cal-trip-panel-num {
  font-variant-numeric: tabular-nums;
  text-align: right !important;
  white-space: nowrap;
}

.cal-trip-panel-time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cal-trip-panel-sub {
  font-size: 11px;
  color: var(--bulma-text-weak);
  white-space: normal;
}

.cal-trip-panel-route {
  display: inline-block;
  min-width: 1.75em;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bulma-scheme-main-ter);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.cal-trip-panel-route-long {
  margin-left: 4px;
}

.cal-trip-panel-pending {
  color: var(--bulma-text-weak);
}

.cal-trip-panel-empty,
.cal-trip-panel-more,
.cal-trip-panel-error {
  font-size: 12px;
  margin: 6px 0;
}

.cal-trip-panel-error {
  color: var(--bulma-danger);
}

.cal-trip-panel-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--bulma-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
</style>
