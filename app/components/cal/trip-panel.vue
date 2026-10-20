<template>
  <div class="cal-sidebar-panel">
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
                  <template v-if="b.route">
                    <cal-route-badge
                      :label="b.route.route_short_name || b.route.route_long_name || b.route.route_id"
                      :color="b.route.route_color"
                      :text-color="b.route.route_text_color"
                    />
                    <span v-if="b.route.route_short_name && b.route.route_long_name" class="cal-trip-panel-route-long">
                      {{ b.route.route_long_name }}
                    </span>
                  </template>
                  <template v-else>
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
          <p v-if="rows.length === 0" class="cal-trip-panel-empty">
            No trips within the current filters.
          </p>
          <template v-else>
            <p v-if="detailsError" class="cal-trip-panel-error">
              Could not load trip details: {{ detailsError }}
              <button type="button" class="cal-trip-panel-link" @click="$emit('loadDetails')">
                Retry
              </button>
            </p>
            <cal-trip-table
              :subject-kind="subject.kind"
              :rows="previewRows"
              :multi-day="trips.dateCount > 1"
              :details-loading="detailsLoading"
            />
            <div class="cal-trip-panel-more">
              <span v-if="rows.length > previewRows.length">
                Showing {{ previewRows.length }} of {{ rows.length.toLocaleString() }} trips.
              </span>
              <cat-button
                class="mt-2"
                size="small"
                icon-left="arrow-expand"
                fullwidth
                @click="$emit('expandTrips')"
              >
                Open full table
              </cat-button>
            </div>
          </template>
        </cat-tab-item>
      </cat-tabs>
    </cat-msg>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ResolvedTripSubject, SubjectTrips, TripTableRow } from '~~/src/scenario'
import { formatDuration, formatGtfsTime } from '~~/src/core'
import type { Route } from '~~/src/tl'

// Keyed by subject where it is used, so each feature opens fresh on Overview.
const props = defineProps<{
  subject: ResolvedTripSubject
  // What the panel describes, as useTripPanel names it.
  title: string
  trips: SubjectTrips
  // trips.rows as table rows, with whatever trip details have arrived.
  rows: TripTableRow[]
  routes: Map<number, Route>
  detailsLoading: boolean
  detailsError: string | null
}>()

const emit = defineEmits<{
  close: []
  // The Trips tab is showing: fetch details for its rows.
  loadDetails: []
  // Open every trip in the full-size table.
  expandTrips: []
}>()

type TripPanelTab = 'overview' | 'trips'
const activeTab = ref<TripPanelTab>('overview')

// The sidebar shows the first few trips; the full table opens in a modal.
const PREVIEW_ROWS = 8

// Details are fetched once the Trips tab is open, and again for new rows as
// the filters change.
watch(
  [activeTab, () => props.trips],
  ([tab]) => {
    if (tab === 'trips') {
      emit('loadDetails')
    }
  },
)

const subjectRoute = computed(() => props.subject.kind === 'route' ? props.routes.get(props.subject.routeId) : undefined)

const countTooltip = computed(() => {
  if (props.subject.kind === 'route') {
    return 'Trips with any departure in the scenario area during the days and times within the current filters, as the Routes report counts them.'
  }
  return 'Visits at the stop by any route during the days and times within the current filters, as the Stops report\'s Total Visits counts them. A trip that calls twice counts twice.'
})

const frequencyText = computed(() => {
  if (props.subject.kind === 'route') {
    const f = subjectRoute.value?.average_frequency
    return f != null ? `Every ${formatDuration(f)}` : ''
  }
  const perHour = props.trips.averagePerHour
  if (!perHour) {
    return ''
  }
  // To the minute, as seconds would claim more precision than an average has,
  // unless trips come more than once a minute.
  const secs = 3600 / perHour
  return `Every ${formatDuration(secs >= 60 ? Math.round(secs / 60) * 60 : Math.round(secs))}`
})

const frequencyTooltip = computed(() => {
  if (props.subject.kind === 'route') {
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

// Trips by route for a stop or cluster; by direction for a route, each named
// by its most common headsign once trip details are in (as www names
// directions), by its GTFS direction_id until then.
const breakdown = computed<BreakdownRow[]>(() => {
  const t = props.trips
  if (t.count === 0) {
    return []
  }
  if (props.subject.kind !== 'route') {
    return t.routeCounts.map(rc => ({
      key: String(rc.routeId),
      label: String(rc.routeId),
      route: props.routes.get(rc.routeId),
      count: rc.count,
    }))
  }
  const byDir = new Map<number, { count: number, headsigns: Map<string, number> }>()
  t.rows.forEach((row, i) => {
    const d = byDir.get(row.directionId) || { count: 0, headsigns: new Map() }
    d.count += row.dates.length
    const h = props.rows[i]?.headsign
    if (h) {
      d.headsigns.set(h, (d.headsigns.get(h) || 0) + row.dates.length)
    }
    byDir.set(row.directionId, d)
  })
  return [...byDir]
    .sort((a, b) => a[0] - b[0])
    .map(([dir, d]) => {
      const top = [...d.headsigns].sort((a, b) => b[1] - a[1])[0]
      return { key: `dir-${dir}`, label: top ? `To ${top[0]}` : `Direction ${dir}`, count: d.count }
    })
})

const previewRows = computed(() => props.rows.slice(0, PREVIEW_ROWS))

function formatAverage (n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
</script>

<style scoped lang="scss">
.cal-sidebar-panel :deep(.tabs) {
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
  }
}

.cal-trip-panel-overview th {
  font-weight: 600;
  width: 55%;
}

.cal-trip-panel-breakdown {
  margin-top: 10px;
}

.cal-trip-panel-num {
  font-variant-numeric: tabular-nums;
  text-align: right !important;
  white-space: nowrap;
}

.cal-trip-panel-route-long {
  margin-left: 4px;
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
