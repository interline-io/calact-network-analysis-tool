<template>
  <div id="cal-route-timetable-top" class="cal-route-timetable">
    <header class="cal-route-timetable-header mb-4">
      <h3 class="is-3 title">
        {{ props.route.agency?.agency_name }} — {{ props.route.route_short_name || props.route.route_id }}
        <span
          v-if="showLongName"
          class="has-text-weight-normal"
        >
          {{ props.route.route_long_name }}
        </span>
      </h3>
      <div class="field is-grouped is-grouped-multiline">
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">agency_id</span>
            <span class="tag is-light">{{ props.route.agency?.agency_id }}</span>
          </div>
        </div>
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-dark">route_id</span>
            <span class="tag is-light">{{ props.route.route_id }}</span>
          </div>
        </div>
      </div>
    </header>

    <cat-tabs v-model="activeTab" type="boxed">
      <cat-tab-item value="trips" label="Trip Timetable" />
      <cat-tab-item value="frequency" label="Frequency Calculation" />
      <cat-tab-item value="stops" label="Stop Details" />
    </cat-tabs>

    <!-- Trips view -->
    <div v-if="activeTab === 'trips'">
      <cat-msg variant="info" title="Summary" class="mb-4">
        <p class="mb-2">
          Totals reflect all departures at stops within selected geographic bounds across the selected date range, subject to any time-of-day or day-of-week filters. Earliest and latest trip times are based on the first and last departures at stops within bounds.
        </p>
        <dl class="cal-route-timetable-gap-stats">
          <div>
            <dt>Included trips:</dt>
            <dd>{{ tripStats?.tripCount }}</dd>
          </div>
          <div>
            <dt>Calendar days:</dt>
            <dd>{{ tripStats?.dateCount }}</dd>
          </div>
          <div v-if="isAllDayMode">
            <dt>Average trips per day:</dt>
            <dd>
              {{ tripStats?.averageTripsPerDay.toFixed(2) }}
              <span class="ml-3 has-text-grey">({{ tripStats?.tripCount }} / {{ tripStats?.dateCount }})</span>
            </dd>
          </div>
          <div v-else>
            <dt>Average trips per hour:</dt>
            <dd>
              {{ tripStats?.averageTripsPerHour.toFixed(2) }}
              <span class="has-text-grey">
                ({{ tripStats?.tripCount }} / {{ tripStats?.hoursInWindow.toFixed(1) }}h &times; {{ tripStats?.dateCount }}d)
              </span>
            </dd>
          </div>
          <div v-if="tripStats?.earliestTripStart != null">
            <dt>Earliest trip start:</dt>
            <dd>
              {{ formatGtfsTimeFull(tripStats.earliestTripStart) }}
            </dd>
          </div>
          <div v-if="tripStats?.earliestTripEnd != null">
            <dt>Earliest trip end:</dt>
            <dd>
              {{ formatGtfsTimeFull(tripStats.earliestTripEnd) }}
            </dd>
          </div>
          <div v-if="tripStats?.latestTripStart != null">
            <dt>Latest trip start:</dt>
            <dd>
              {{ formatGtfsTimeFull(tripStats.latestTripStart) }}
            </dd>
          </div>
          <div v-if="tripStats?.latestTripEnd != null">
            <dt>Latest trip end:</dt>
            <dd>
              {{ formatGtfsTimeFull(tripStats.latestTripEnd) }}
            </dd>
          </div>
        </dl>
      </cat-msg>

      <p v-if="!hasAnyRows">
        No trips found for this route in the selected filters.
      </p>

      <cat-msg variant="info" title="Jump to date">
        <div
          v-for="section in unrolledSections"
          :key="`nav-${section.directionId}`"
          class="cal-route-timetable-direction-nav mb-2"
        >
          <h4 class="has-text-weight-bold">
            Direction {{ section.directionId }}
          </h4>
          <div class="cal-route-timetable-date-nav">
            <button
              v-for="group in section.dateGroups"
              :key="group.serviceDate"
              type="button"
              class="cal-route-timetable-date-nav-btn"
              @click="scrollTo(`trips-dir${section.directionId}-${group.serviceDate}`)"
            >
              {{ formatServiceDate(group.serviceDate) }} <span class="has-text-grey">({{ group.rows.length }})</span>
            </button>
          </div>
        </div>
      </cat-msg>

      <cat-download-csv
        v-if="tripsCsvData.length > 0"
        :data="tripsCsvData"
        :filename="`${routeIdPrefix}-trips`"
        label="Download CSV"
        class="mb-4"
      />

      <section
        v-for="section in unrolledSections"
        :key="section.directionId"
        class="cal-route-timetable-section mb-5"
      >
        <h3 class="is-size-4 has-text-weight-bold">
          Direction {{ section.directionId }}
        </h3>
        <table class="table is-fullwidth is-narrow cal-route-timetable-table cal-route-timetable-trips-table">
          <thead>
            <tr>
              <th>Trip ID</th>
              <th>
                <cat-tooltip text="First stop for this trip within selected bounds, if different than the representative stop.">
                  First Stop in Bounds
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip text="A representative stop within bounds is chosen for each route and service date. See the Stops tab for calculation details.">
                  Representative Stop
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip text="Last stop for this trip within selected bounds, if different than the representative stop.">
                  Last Stop in Bounds
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
            </tr>
          </thead>
          <tbody
            v-for="group in section.dateGroups"
            :id="`trips-dir${section.directionId}-${group.serviceDate}`"
            :key="group.serviceDate"
          >
            <tr class="cal-route-timetable-date-separator">
              <td colspan="4">
                {{ formatServiceDate(group.serviceDate) }} ({{ group.rows.length }} trips)
                <button type="button" class="cal-route-timetable-top-btn" @click="scrollToTop">
                  top
                </button>
              </td>
            </tr>
            <tr
              v-for="(row, ri) in group.rows"
              :key="row.tripId"
              :class="{
                'cal-route-timetable-row-muted': !row.inWindow,
                'cal-route-timetable-row-striped': ri % 2 === 1,
              }"
            >
              <td class="cal-route-timetable-trip-id">
                {{ tripIdLabel(row.tripId) }}
              </td>
              <td>
                <template v-if="row.firstStopId !== row.representativeStopId">
                  <span>{{ stopName(row.firstStopId) }}</span>
                  <span class="cal-route-timetable-gtfs-time">
                    {{ formatGtfsTimeFull(row.firstDepartureTime) }}
                  </span>
                </template>
                <span v-else>—</span>
              </td>
              <td>
                <template v-if="row.representativeStopId != null">
                  <span>{{ stopName(row.representativeStopId) }}</span>
                  <span
                    v-if="row.repStopDepartureTime != null"
                    class="cal-route-timetable-gtfs-time"
                  >
                    {{ formatGtfsTimeFull(row.repStopDepartureTime) }}
                  </span>
                  <span v-else class="cal-route-timetable-gtfs-time">
                    —
                  </span>
                </template>
                <span v-else>—</span>
              </td>
              <td>
                <template v-if="row.lastStopId !== row.representativeStopId">
                  <span>{{ stopName(row.lastStopId) }}</span>
                  <span class="cal-route-timetable-gtfs-time">
                    {{ formatGtfsTimeFull(row.lastDepartureTime) }}
                  </span>
                </template>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Frequency Calculation view -->
    <div v-else-if="activeTab === 'frequency'">
      <p v-if="frequencyRows.length === 0">
        No representative-stop departures contribute to the frequency calculation for this route in the selected filters.
      </p>

      <div v-else>
        <div v-if="gapStats" class="cal-route-timetable-gap-summary mb-4">
          <p class="mb-2">
            Every dominant-direction representative-stop departure across the selected service days that feeds the average / fastest / slowest frequency calculation. Gaps under {{ MIN_HEADWAY_SECONDS }} seconds are shown struck through and excluded from the summary.
          </p>
          <dl class="cal-route-timetable-gap-stats">
            <div>
              <dt>Min (fastest):</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.min) }}</strong>
                <span class="ml-3">({{ gapStats.min }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Median:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.median) }}</strong>
                <span class="ml-3">({{ gapStats.median }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Max (slowest):</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.max) }}</strong>
                <span class="ml-3">({{ gapStats.max }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Average:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.avg) }}</strong>
                <span class="ml-3">({{ gapStats.avg.toFixed(1) }}s)</span>
                <span> — n = {{ gapStats.count }}</span>
              </dd>
            </div>
          </dl>
          <div class="mt-2 mb-1">
            Sorted contributing gaps (seconds) — min / median / max in bold:
          </div>
          <div class="cal-route-timetable-gap-list">
            <template v-for="(g, i) in contributingGaps" :key="i">
              <strong
                v-if="i === 0 || gapStats.medianIndices.has(i) || i === contributingGaps.length - 1"
              >{{ g }}</strong>
              <template v-else>
                {{ g }}
              </template>
              <template v-if="i < contributingGaps.length - 1">
                ,
              </template>
            </template>
          </div>
        </div>

        <cat-download-csv
          v-if="frequencyCsvData.length > 0"
          :data="frequencyCsvData"
          :filename="`${routeIdPrefix}-frequency`"
          label="Download CSV"
          class="mb-4"
        />

        <div class="cal-route-timetable-date-nav mb-2">
          <button
            v-for="group in frequencyDateGroups"
            :key="group.serviceDate"
            type="button"
            class="cal-route-timetable-date-nav-btn"
            @click="scrollTo(`freq-${group.serviceDate}`)"
          >
            {{ formatServiceDate(group.serviceDate) }}
          </button>
        </div>
        <table class="table is-fullwidth is-narrow cal-route-timetable-table">
          <thead>
            <tr>
              <th>Trip ID</th>
              <th>Dir</th>
              <th>Stop</th>
              <th>Departure</th>
              <th>Gap to next</th>
              <th>Gap (seconds)</th>
            </tr>
          </thead>
          <tbody
            v-for="group in frequencyDateGroups"
            :id="`freq-${group.serviceDate}`"
            :key="group.serviceDate"
          >
            <tr class="cal-route-timetable-date-separator">
              <td colspan="6">
                {{ formatServiceDate(group.serviceDate) }}
                <button type="button" class="cal-route-timetable-top-btn" @click="scrollToTop">
                  top
                </button>
              </td>
            </tr>
            <tr
              v-for="(row, i) in group.rows"
              :key="i"
              :class="{ 'cal-route-timetable-row-striped': i % 2 === 1 }"
            >
              <td class="cal-route-timetable-trip-id">
                {{ tripIdLabel(row.tripId) }}
              </td>
              <td>{{ row.directionId }}</td>
              <td>
                <cat-tooltip :text="stopTooltip(row.stopId)">
                  {{ stopName(row.stopId) }}
                </cat-tooltip>
              </td>
              <td class="cal-route-timetable-gtfs-time">
                {{ formatGtfsTimeFull(row.departureTime) }}
              </td>
              <td>
                <span v-if="row.gapToNext == null">—</span>
                <cat-tooltip
                  v-else-if="row.gapIsNoise"
                  :text="`Gap below the ${MIN_HEADWAY_SECONDS}-second noise threshold; excluded from frequency calculation.`"
                >
                  <span class="cal-route-timetable-noise-gap">
                    {{ formatGtfsTimeFull(row.gapToNext) }}
                  </span>
                </cat-tooltip>
                <span v-else class="cal-route-timetable-gtfs-time">
                  {{ formatGtfsTimeFull(row.gapToNext) }}
                </span>
              </td>
              <td class="cal-route-timetable-trip-id">
                <span v-if="row.gapToNext == null">—</span>
                <span v-else-if="row.gapIsNoise" class="cal-route-timetable-noise-gap">
                  {{ row.gapToNext }}
                </span>
                <span v-else>{{ row.gapToNext }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Stop Details view -->
    <div v-else-if="activeTab === 'stops'">
      <p v-if="stopDetailDateGroups.length === 0">
        No stop data for this route in the selected filters.
      </p>

      <div v-else>
        <div class="cal-route-timetable-gap-summary mb-4">
          <p>
            In-area stops served by this route on each service day, with departure counts per direction. The representative stop for the dominant direction is marked with a check icon.
          </p>
        </div>

        <cat-download-csv
          v-if="stopDetailsCsvData.length > 0"
          :data="stopDetailsCsvData"
          :filename="`${routeIdPrefix}-stops`"
          label="Download CSV"
          class="mb-4"
        />

        <div class="cal-route-timetable-date-nav mb-2">
          <button
            v-for="group in stopDetailDateGroups"
            :key="group.serviceDate"
            type="button"
            class="cal-route-timetable-date-nav-btn"
            @click="scrollTo(`stops-${group.serviceDate}`)"
          >
            {{ formatServiceDate(group.serviceDate) }}
          </button>
        </div>
        <table class="table is-fullwidth is-narrow cal-route-timetable-table">
          <thead>
            <tr>
              <th>Stop ID</th>
              <th>Stop Name</th>
              <th>Dir</th>
              <th>Departures</th>
            </tr>
          </thead>
          <tbody
            v-for="group in stopDetailDateGroups"
            :id="`stops-${group.serviceDate}`"
            :key="group.serviceDate"
          >
            <tr class="cal-route-timetable-date-separator">
              <td colspan="4">
                {{ formatServiceDate(group.serviceDate) }}
                <button type="button" class="cal-route-timetable-top-btn" @click="scrollToTop">
                  top
                </button>
              </td>
            </tr>
            <tr
              v-for="(row, i) in group.rows"
              :key="`${row.stopId}-${row.directionId}`"
              :class="{ 'cal-route-timetable-row-striped': i % 2 === 1 }"
            >
              <td>{{ stopIdStr(row.stopId) }}</td>
              <td>
                <cat-tooltip :text="stopTooltip(row.stopId)">
                  {{ stopName(row.stopId) }}
                </cat-tooltip>
              </td>
              <td>{{ row.directionId }}</td>
              <td>
                {{ row.departureCount }}
                <cat-tooltip
                  v-if="row.isRepresentativeStop"
                  text="Representative stop for the dominant direction — used for frequency calculation"
                >
                  <cat-icon icon="check" size="small" class="has-text-primary ml-1" />
                </cat-tooltip>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { format } from 'date-fns'
import type { Route } from '~~/src/tl'
import type { ScenarioFilterResult } from '~~/src/scenario'
import { buildRouteTimetable } from '~~/src/scenario'
import { formatGtfsTimeFull } from '~~/src/core'
import {
  pickRepresentativeStop,
  pickDominantDirection,
  routeHeadways,
  computeHeadwaysPerDay,
  calculateRouteTripStats,
  MIN_HEADWAY_SECONDS,
} from '~~/src/scenario/route-headway'
import { RouteDepartureIndex } from '~~/src/tl/departure-cache'

type Tab = 'frequency' | 'trips' | 'stops'

interface TimetableRowWithDate {
  serviceDate: string
  tripId: number
  directionId: number
  firstStopId: number
  firstDepartureTime: number
  lastStopId: number
  lastDepartureTime: number
  repStopDepartureTime?: number
  representativeStopId?: number
  inWindow: boolean
}

interface DateGroup {
  serviceDate: string
  rows: TimetableRowWithDate[]
}

interface UnrolledSection {
  directionId: number
  dateGroups: DateGroup[]
}

interface FrequencyRow {
  serviceDate: string
  tripId: number
  directionId: number
  stopId: number
  departureTime: number
  gapToNext?: number
  gapIsNoise: boolean
}

const props = defineProps<{
  route: Route
  scenarioFilterResult: ScenarioFilterResult
  selectedDateRange: Date[]
  startTime?: Date
  endTime?: Date
  initialTab?: Tab
}>()

// Build the route-departure index lazily from the scenario cache. Keeping this
// a computed means the O(cache) iteration only runs when the modal opens.
const routeIndex = computed(() =>
  RouteDepartureIndex.fromCache(props.scenarioFilterResult.stopDepartureCache),
)

const startTimeSec = computed(() =>
  props.startTime ? dateToSec(props.startTime) : 0,
)
const endTimeSec = computed(() =>
  props.endTime ? dateToSec(props.endTime) : 86400,
)

const startTimeStr = computed(() =>
  props.startTime ? format(props.startTime, 'HH:mm:ss') : undefined,
)
const endTimeStr = computed(() =>
  props.endTime ? format(props.endTime, 'HH:mm:ss') : undefined,
)

// Build timetable data across ALL service days, unrolled into per-direction
// flat arrays with a serviceDate + representativeStopId tagged on each row.
const unrolledSections = computed<UnrolledSection[]>(() => {
  const dir0Groups: DateGroup[] = []
  const dir1Groups: DateGroup[] = []
  for (const d of props.selectedDateRange) {
    const dateStr = format(d, 'yyyy-MM-dd')
    const tt = buildRouteTimetable(props.route, dateStr, startTimeSec.value, endTimeSec.value, routeIndex.value)
    for (const dir of [tt.dir0, tt.dir1]) {
      if (dir.rows.length === 0) {
        continue
      }
      const groups = dir.directionId === 0 ? dir0Groups : dir1Groups
      const rows: TimetableRowWithDate[] = dir.rows.map(row => ({
        serviceDate: dateStr,
        tripId: row.tripId,
        directionId: row.directionId,
        firstStopId: row.firstStopId,
        firstDepartureTime: row.firstDepartureTime,
        lastStopId: row.lastStopId,
        lastDepartureTime: row.lastDepartureTime,
        repStopDepartureTime: row.repStopDepartureTime,
        representativeStopId: dir.representativeStopId,
        inWindow: row.inWindow,
      }))
      groups.push({ serviceDate: dateStr, rows })
    }
  }
  const out: UnrolledSection[] = []
  if (dir0Groups.length > 0) {
    out.push({ directionId: 0, dateGroups: dir0Groups })
  }
  if (dir1Groups.length > 0) {
    out.push({ directionId: 1, dateGroups: dir1Groups })
  }
  return out
})

// Go through the same `routeHeadways` path that scenario-filter uses, then pick
// the dominant direction via the shared helper — guarantees the UI can't drift
// from the actual frequency-calc direction.
const routeDeps = computed(() =>
  routeHeadways(
    props.route,
    props.selectedDateRange,
    startTimeStr.value,
    endTimeStr.value,
    routeIndex.value,
  ),
)

const dominantDirection = computed(() => pickDominantDirection(routeDeps.value))

// Trip-count statistics — calls the same pure function that scenario-filter
// uses for average_trips_per_day / average_trips_per_hour / earliest-latest.
const tripStats = computed(() =>
  calculateRouteTripStats(
    props.route,
    props.selectedDateRange,
    startTimeStr.value,
    endTimeStr.value,
    routeIndex.value,
  ),
)

const isAllDayMode = computed(() => props.startTime == null && props.endTime == null)

// Show long name only when it adds information beyond the short name.
const showLongName = computed(() => {
  const short = props.route.route_short_name || ''
  const long = props.route.route_long_name || ''
  return long !== '' && !long.includes(short) && short !== long
})

const hasAnyRows = computed(() => unrolledSections.value.length > 0)

const activeTab = ref<Tab>(props.initialTab ?? 'trips')

// Frequency Calculation view: every dominant-direction representative-stop
// departure across all selected service days, in the time-of-day window.
// These are the exact numbers that feed average/fastest/slowest frequency.
// Gap/noise classification is delegated to `computeHeadwaysPerDay` — the same
// helper that `calculateHeadwayStats` uses — so this view can never drift
// from the actual frequency calculation.
const frequencyRows = computed<FrequencyRow[]>(() => {
  const out: FrequencyRow[] = []
  const dir = dominantDirection.value
  for (const d of props.selectedDateRange) {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rep = pickRepresentativeStop(routeIndex.value, props.route.id, dir, dateStr)
    if (rep.stopId === undefined) {
      continue
    }
    const inWindow = rep.departures
      .filter(st => st.departureTime >= startTimeSec.value && st.departureTime <= endTimeSec.value)
      .sort((a, b) => a.departureTime - b.departureTime)
    // Shared helper returns one Headway<T> per consecutive pair; entry `i` is
    // the pair (inWindow[i], inWindow[i + 1]). Length is inWindow.length - 1.
    const headways = computeHeadwaysPerDay([inWindow], st => st.departureTime)
    for (let i = 0; i < inWindow.length; i++) {
      const st = inWindow[i]!
      const h = headways[i]
      out.push({
        serviceDate: dateStr,
        tripId: st.tripId,
        directionId: dir,
        stopId: rep.stopId,
        departureTime: st.departureTime,
        gapToNext: h?.gap,
        gapIsNoise: h?.isNoise ?? false,
      })
    }
  }
  return out
})

interface FrequencyDateGroup {
  serviceDate: string
  rows: FrequencyRow[]
}

const frequencyDateGroups = computed<FrequencyDateGroup[]>(() => {
  const groups: FrequencyDateGroup[] = []
  let current: FrequencyDateGroup | undefined
  for (const row of frequencyRows.value) {
    if (!current || current.serviceDate !== row.serviceDate) {
      current = { serviceDate: row.serviceDate, rows: [] }
      groups.push(current)
    }
    current.rows.push(row)
  }
  return groups
})

// The exact array fed to calculateHeadwayStats: non-noise gaps, sorted ascending.
const contributingGaps = computed<number[]>(() => {
  const gaps = frequencyRows.value
    .filter(r => r.gapToNext !== undefined && !r.gapIsNoise)
    .map(r => r.gapToNext!)
  gaps.sort((a, b) => a - b)
  return gaps
})

const gapStats = computed(() => {
  const gaps = contributingGaps.value
  if (gaps.length === 0) {
    return undefined
  }
  const min = gaps[0]!
  const max = gaps[gaps.length - 1]!
  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 === 1
    ? gaps[mid]!
    : (gaps[mid - 1]! + gaps[mid]!) / 2
  // Indices to bold in the sorted gap list: the two middle entries for even
  // length, or the single middle entry for odd.
  const medianIndices = gaps.length % 2 === 1
    ? new Set([mid])
    : new Set([mid - 1, mid])
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return { min, max, median, medianIndices, avg, count: gaps.length }
})

// Stop lookup: build once per scenarioFilterResult change.
const stopsById = computed(() => {
  const m = new Map<number, { stop_id: string, stop_name?: string }>()
  for (const s of props.scenarioFilterResult.stops) {
    m.set(s.id, { stop_id: s.stop_id, stop_name: s.stop_name })
  }
  return m
})

function stopName (id: number): string {
  return stopsById.value.get(id)?.stop_name || `Stop ${id}`
}
function tripIdLabel (numericId: number): string {
  return props.scenarioFilterResult.tripIdStrings?.get(numericId) ?? String(numericId)
}
function stopTooltip (id: number): string {
  const s = stopsById.value.get(id)
  if (!s) {
    return `Stop ${id}`
  }
  return `${s.stop_id} · ${s.stop_name || ''}`.trim()
}

function dateToSec (d: Date): number {
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
}

function formatServiceDate (dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  return format(date, 'EEE dd, MMM, yyyy')
}

function scrollTo (id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToTop () {
  scrollTo('cal-route-timetable-top')
}

interface StopDetailRow {
  stopId: number
  directionId: number
  departureCount: number
  isRepresentativeStop: boolean
}

interface StopDetailDateGroup {
  serviceDate: string
  rows: StopDetailRow[]
}

const stopDetailDateGroups = computed<StopDetailDateGroup[]>(() => {
  const groups: StopDetailDateGroup[] = []
  for (const d of props.selectedDateRange) {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rows: StopDetailRow[] = []
    const dominant = dominantDirection.value
    for (const dir of [0, 1]) {
      const rep = pickRepresentativeStop(routeIndex.value, props.route.id, dir, dateStr)
      const dateStopDeps = routeIndex.value.getRouteDate(props.route.id, dir, dateStr)
      for (const [sid, deps] of dateStopDeps.entries()) {
        rows.push({
          stopId: sid,
          directionId: dir,
          departureCount: deps.length,
          isRepresentativeStop: sid === rep.stopId && dir === dominant,
        })
      }
    }
    if (rows.length > 0) {
      rows.sort((a, b) => a.directionId - b.directionId || b.departureCount - a.departureCount)
      groups.push({ serviceDate: dateStr, rows })
    }
  }
  return groups
})

const stopDetailsCsvData = computed(() => {
  return stopDetailDateGroups.value.flatMap(group =>
    group.rows.map(row => ({
      service_date: group.serviceDate,
      direction_id: row.directionId,
      stop_id: stopIdStr(row.stopId),
      stop_name: stopName(row.stopId),
      departure_count: row.departureCount,
      is_representative_stop: row.isRepresentativeStop,
    })),
  )
})

function stopIdStr (id: number): string {
  return stopsById.value.get(id)?.stop_id || String(id)
}

const routeIdPrefix = computed(() => props.route.route_short_name || props.route.route_id)

const tripsCsvData = computed(() => {
  const rows: Record<string, unknown>[] = []
  for (const section of unrolledSections.value) {
    for (const group of section.dateGroups) {
      for (const row of group.rows) {
        rows.push({
          service_date: row.serviceDate,
          direction_id: row.directionId,
          trip_id: tripIdLabel(row.tripId),
          in_window: row.inWindow,
          first_stop_id: stopIdStr(row.firstStopId),
          first_stop_name: stopName(row.firstStopId),
          first_departure: formatGtfsTimeFull(row.firstDepartureTime),
          representative_stop_id: row.representativeStopId != null ? stopIdStr(row.representativeStopId) : '',
          representative_stop_name: row.representativeStopId != null ? stopName(row.representativeStopId) : '',
          representative_stop_departure: row.repStopDepartureTime != null ? formatGtfsTimeFull(row.repStopDepartureTime) : '',
          last_stop_id: stopIdStr(row.lastStopId),
          last_stop_name: stopName(row.lastStopId),
          last_departure: formatGtfsTimeFull(row.lastDepartureTime),
        })
      }
    }
  }
  return rows
})

const frequencyCsvData = computed(() => {
  return frequencyRows.value.map(row => ({
    service_date: row.serviceDate,
    direction_id: row.directionId,
    trip_id: tripIdLabel(row.tripId),
    stop_id: stopIdStr(row.stopId),
    stop_name: stopName(row.stopId),
    departure: formatGtfsTimeFull(row.departureTime),
    departure_seconds: row.departureTime,
    gap_to_next: row.gapToNext != null ? formatGtfsTimeFull(row.gapToNext) : '',
    gap_to_next_seconds: row.gapToNext ?? '',
    gap_is_noise: row.gapIsNoise,
  }))
})
</script>

<style scoped lang="scss">
.cal-route-timetable-gtfs-time {
  display: block;
  font-variant-numeric: tabular-nums;
}
.cal-route-timetable-trip-id {
  font-variant-numeric: tabular-nums;
  color: #666;
}
.cal-route-timetable-row-striped > td {
  background: var(--bulma-table-striped-row-even-background-color, #fafafa);
}
.cal-route-timetable-row-muted {
  opacity: 0.5;
}
.cal-route-timetable-direction-nav {
  h4 {
    margin-bottom: 0.25rem;
  }
}
.cal-route-timetable-date-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.cal-route-timetable-date-nav-btn {
  background: none;
  border: 1px solid var(--bulma-border, #dbdbdb);
  border-radius: 3px;
  padding: 0.15em 0.5em;
  cursor: pointer;
  font: inherit;
  color: inherit;

  &:hover {
    background: var(--bulma-scheme-main-bis, #fafafa);
  }
}
.cal-route-timetable-top-btn {
  background: none;
  border: none;
  padding: 0;
  margin-left: 0.75em;
  font: inherit;
  color: var(--bulma-grey, #7a7a7a);
  cursor: pointer;
  text-decoration: underline;
}
tbody + tbody > .cal-route-timetable-date-separator > td {
  border-top: 0.75em solid transparent;
}
.cal-route-timetable-date-separator > td {
  font-weight: 600;
  padding-top: 0.6em;
  padding-bottom: 0.4em;
  border-bottom: 1px solid var(--bulma-border, #dbdbdb);
}
.cal-route-timetable-day-break > td {
  border-top: 2px solid var(--bulma-grey-light, #999);
}
.cal-route-timetable-trips-table {
  table-layout: fixed;

  th,
  td {
    width: 25%;
  }
}
.cal-route-timetable-noise-gap {
  font-variant-numeric: tabular-nums;
  color: #888;
  text-decoration: line-through;
}
.cal-route-timetable-gap-summary {
  padding: 0.75rem;
  background: var(--bulma-scheme-main-ter, #f5f5f5);
  border-radius: 4px;
}
.cal-route-timetable-gap-list {
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  line-height: 1.6;
  word-spacing: 0.15rem;
}
.cal-route-timetable-gap-stats {
  display: grid;
  grid-template-columns: auto auto;
  column-gap: 0.75rem;
  row-gap: 0.25rem;
  justify-content: start;

  > div {
    display: contents;
  }

  dt {
    font-weight: 600;
  }

  dd {
    font-variant-numeric: tabular-nums;
  }
}
</style>
