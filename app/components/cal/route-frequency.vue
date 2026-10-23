<template>
  <div id="cal-route-frequency-top" class="cal-route-frequency">
    <header class="cal-route-frequency-header mb-4">
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
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-info">days</span>
            <span class="tag is-light">{{ weekdayScopeLabel }}</span>
          </div>
        </div>
        <div class="control">
          <div class="tags has-addons">
            <span class="tag is-info">time</span>
            <span class="tag is-light">{{ timeWindowLabel }}</span>
          </div>
        </div>
      </div>
    </header>

    <!-- Calculations: how the Routes report gets its trip counts, times, and frequency -->
    <div v-if="tab === 'calculations'">
      <cat-msg variant="info" title="Trip counts and times" class="mb-4">
        <p class="mb-2">
          Totals reflect all departures at stops within selected geographic bounds across the selected date range, subject to any time-of-day or day-of-week filters. Earliest and latest trip times are based on the first and last departures at stops within bounds.
        </p>
        <dl class="cal-route-frequency-gap-stats">
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

      <p v-if="frequencyRows.length === 0">
        No representative-stop departures contribute to the frequency calculation for this route in the selected filters.
      </p>

      <div v-else>
        <cat-msg variant="info" title="About this frequency" class="mb-4">
          <p>
            Route frequency is automatically derived from GTFS feeds and may differ from how agencies classify their own routes.
          </p>
        </cat-msg>

        <cat-msg
          v-if="frequencyCaveats.irregular"
          variant="warning"
          title="Irregular service"
          class="mb-4"
        >
          <p class="mb-2">
            This route's service is not consistent across the day — it has a multi-hour gap with no service (see the slowest gap below), typical of commuter-peak, school, or other time-concentrated service. A single average frequency may not reflect typical wait times.
          </p>
          <dl v-if="gapStats" class="cal-route-frequency-gap-stats">
            <div>
              <dt>Fastest gap:</dt>
              <dd>{{ formatDuration(gapStats.min) }}</dd>
            </div>
            <div>
              <dt>Median gap:</dt>
              <dd>{{ formatDuration(gapStats.median) }}</dd>
            </div>
            <div>
              <dt>Slowest gap:</dt>
              <dd>{{ formatDuration(gapStats.max) }}</dd>
            </div>
          </dl>
        </cat-msg>

        <cat-msg
          v-if="frequencyCaveats.directionsDifferMaterially"
          variant="warning"
          title="Directions differ"
          class="mb-4"
        >
          <p class="mb-2">
            The two directions of this route run at materially different frequencies. The reported frequency uses only the dominant direction (Direction {{ frequencyCaveats.comparison.dominantDirection }}).
          </p>
          <dl class="cal-route-frequency-gap-stats">
            <div>
              <dt>Direction 0 average:</dt>
              <dd>{{ frequencyCaveats.comparison.dir0Average != null ? formatDuration(frequencyCaveats.comparison.dir0Average) : '—' }}</dd>
            </div>
            <div>
              <dt>Direction 1 average:</dt>
              <dd>{{ frequencyCaveats.comparison.dir1Average != null ? formatDuration(frequencyCaveats.comparison.dir1Average) : '—' }}</dd>
            </div>
          </dl>
        </cat-msg>

        <cat-msg
          v-if="repeatRepStopVisits > 0"
          variant="warning"
          title="Repeat visits excluded"
          class="mb-4"
        >
          <p>
            {{ repeatRepStopVisits }} departures at the representative stop are repeat visits by the same trip, which happens when the stop is both the first and last stop of a loop. Only each trip's first departure is counted toward frequency, so the loop turnaround is not mistaken for a short headway.
          </p>
        </cat-msg>
        <cat-msg variant="info" title="Summary" class="mb-4">
          <p class="mb-2">
            Frequency is calculated from gaps between consecutive departures at the representative stop, using only the dominant direction. Only service dates matching the selected weekdays contribute to the statistics; out-of-scope dates are still listed below but flagged and excluded. Gaps under {{ MIN_HEADWAY_SECONDS }} seconds are considered noise and excluded (shown struck through below).
          </p>
          <p v-if="!gapStats" class="has-text-grey">
            No in-scope departure gaps contribute to the frequency statistics for the current weekday selection. Service dates are listed below.
          </p>
          <dl v-if="gapStats" class="cal-route-frequency-gap-stats">
            <div>
              <dt>Min (fastest):</dt>
              <dd>
                {{ formatDuration(gapStats.min) }}
                <span class="ml-3 has-text-grey">({{ gapStats.min }})</span>
              </dd>
            </div>
            <div>
              <dt>Median:</dt>
              <dd>
                {{ formatDuration(gapStats.median) }}
                <span class="ml-3 has-text-grey">({{ gapStats.median }})</span>
              </dd>
            </div>
            <div>
              <dt>Max (slowest):</dt>
              <dd>
                {{ formatDuration(gapStats.max) }}
                <span class="ml-3 has-text-grey">({{ gapStats.max }})</span>
              </dd>
            </div>
            <div>
              <dt>Average:</dt>
              <dd>
                {{ formatDuration(gapStats.avg) }}
                <span class="ml-3 has-text-grey">({{ gapStats.avg.toFixed(1) }}) — n = {{ gapStats.count }}</span>
              </dd>
            </div>
          </dl>
          <div v-if="dowFrequencyRollup.length > 1" class="mt-3">
            <p class="has-text-weight-semibold mb-1">
              By day of week
            </p>
            <table class="table is-narrow cal-route-frequency-dow-table">
              <caption class="is-sr-only">
                Frequency by day of week
              </caption>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>n</th>
                  <th>Fastest</th>
                  <th>Median</th>
                  <th>Slowest</th>
                  <th>Average</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in dowFrequencyRollup" :key="r.weekday">
                  <td>{{ r.label }}</td>
                  <td>{{ r.count }}</td>
                  <td>{{ formatDuration(r.min) }}</td>
                  <td>{{ formatDuration(r.median) }}</td>
                  <td>{{ formatDuration(r.max) }}</td>
                  <td>{{ formatDuration(r.avg) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <details v-if="gapStats" class="mt-2 is-size-7">
            <summary>Sorted contributing gaps (seconds) — min, median, max in bold</summary>
            <div class="cal-route-frequency-gap-list mt-1">
              <template v-for="(g, i) in contributingGaps" :key="i">
                <strong
                  v-if="i === 0 || gapStats.medianIndices.has(i) || i === contributingGaps.length - 1"
                >{{ g }}, </strong>
                <template v-else>
                  {{ g }},
                </template>
              </template>
            </div>
          </details>
        </cat-msg>

        <cat-msg v-if="chartDepartures.length > 0" variant="info" title="Departures by hour" class="mb-4">
          <cal-hourly-departures-chart
            :departures="chartDepartures"
            :start-hour="chartStartHour"
            :end-hour="chartEndHour"
          />
        </cat-msg>

        <cat-msg variant="info" title="Jump to date">
          <div class="cal-route-frequency-date-nav">
            <button
              v-for="group in frequencyDateGroups"
              :key="group.serviceDate"
              type="button"
              class="cal-route-frequency-date-nav-btn"
              @click="scrollTo(`freq-${group.serviceDate}`)"
            >
              {{ formatServiceDate(group.serviceDate) }} ({{ group.rows.length }})
            </button>
          </div>
        </cat-msg>

        <cat-download-csv
          v-if="frequencyCsvData.length > 0"
          :data="frequencyCsvData"
          :filename="`${routeIdPrefix}-frequency`"
          label="Download CSV"
          class="mb-4"
        />

        <table class="table is-fullwidth is-narrow cal-route-frequency-table">
          <caption class="is-sr-only">
            Departures and gaps
          </caption>
          <thead>
            <tr>
              <th>Trip ID</th>
              <th>
                <cat-tooltip text="The dominant direction is selected for each service date based on which direction has the most departures. See Stop Details for details.">
                  Direction
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip text="A representative stop within bounds is chosen for each route and service date. See Stop Details for calculation details.">
                  Representative Stop
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip text="Departure time from the representative stop for this trip.">
                  Departure
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip :text="`Time until the next departure at the representative stop. Gaps under ${MIN_HEADWAY_SECONDS} seconds are considered noise and shown struck through.`">
                  Gap
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>Gap (seconds)</th>
            </tr>
          </thead>
          <tbody
            v-for="group in frequencyDateGroups"
            :id="`freq-${group.serviceDate}`"
            :key="group.serviceDate"
          >
            <tr :class="['cal-route-frequency-date-separator', { 'cal-route-frequency-row-excluded': !group.inScope }]">
              <td colspan="6">
                {{ formatServiceDate(group.serviceDate) }} ({{ group.rows.length }} departures)
                <span v-if="!group.inScope" class="tag is-warning is-light ml-2">excluded (not in selected weekdays)</span>
                <button type="button" class="cal-route-frequency-top-btn" @click="scrollToTop">
                  top
                </button>
              </td>
            </tr>
            <tr
              v-for="(row, i) in group.rows"
              :key="i"
              :class="{
                'cal-route-frequency-row-muted': !group.inScope,
                'cal-route-frequency-row-striped': i % 2 === 1,
              }"
            >
              <td class="cal-route-frequency-trip-id">
                {{ tripIdLabel(row.tripId) }}
              </td>
              <td>{{ row.directionId }}</td>
              <td>{{ stopName(row.stopId) }}</td>
              <td class="cal-route-frequency-gtfs-time">
                {{ formatGtfsTimeFull(row.departureTime) }}
              </td>
              <td>
                <span v-if="row.gapToNext == null">—</span>
                <span v-else-if="row.gapIsNoise" class="cal-route-frequency-noise-gap">
                  {{ formatDuration(row.gapToNext) }}
                </span>
                <span v-else class="cal-route-frequency-gtfs-time">
                  {{ formatDuration(row.gapToNext) }}
                </span>
              </td>
              <td class="cal-route-frequency-trip-id">
                <span v-if="row.gapToNext == null">—</span>
                <span v-else-if="row.gapIsNoise" class="cal-route-frequency-noise-gap">
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
    <div v-else-if="tab === 'stops'">
      <p v-if="stopDetailDateGroups.length === 0">
        No stop data for this route in the selected filters.
      </p>

      <div v-else>
        <cat-msg variant="info" title="Summary" class="mb-4">
          <p>
            Stops within bounds served by this route on each service day, with departure counts per direction. The representative stop for the dominant direction is marked with a check icon. The representative stop is selected as the stop with the most departures in the dominant direction.
          </p>
        </cat-msg>

        <cat-msg variant="info" title="Jump to date">
          <div class="cal-route-frequency-date-nav">
            <button
              v-for="group in stopDetailDateGroups"
              :key="group.serviceDate"
              type="button"
              class="cal-route-frequency-date-nav-btn"
              @click="scrollTo(`stops-${group.serviceDate}`)"
            >
              {{ formatServiceDate(group.serviceDate) }} ({{ group.rows.length }})
            </button>
          </div>
        </cat-msg>

        <cat-download-csv
          v-if="stopDetailsCsvData.length > 0"
          :data="stopDetailsCsvData"
          :filename="`${routeIdPrefix}-stops`"
          label="Download CSV"
          class="mb-4"
        />

        <table class="table is-fullwidth is-narrow cal-route-frequency-table">
          <caption class="is-sr-only">
            Stops served
          </caption>
          <thead>
            <tr>
              <th>Stop ID</th>
              <th>Stop Name</th>
              <th>
                <cat-tooltip text="The dominant direction is selected for each service date based on which direction has the most departures.">
                  Direction
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
              <th>
                <cat-tooltip text="Number of departures at this stop in this direction on this service date.">
                  Departures
                  <cat-icon size="small" icon="information" />
                </cat-tooltip>
              </th>
            </tr>
          </thead>
          <tbody
            v-for="group in stopDetailDateGroups"
            :id="`stops-${group.serviceDate}`"
            :key="group.serviceDate"
          >
            <tr :class="['cal-route-frequency-date-separator', { 'cal-route-frequency-row-excluded': !group.inScope }]">
              <td colspan="4">
                {{ formatServiceDate(group.serviceDate) }} ({{ group.rows.length }} stops)
                <span v-if="!group.inScope" class="tag is-warning is-light ml-2">excluded (not in selected weekdays)</span>
                <button type="button" class="cal-route-frequency-top-btn" @click="scrollToTop">
                  top
                </button>
              </td>
            </tr>
            <tr
              v-for="(row, i) in group.rows"
              :key="`${row.stopId}-${row.directionId}`"
              :class="{
                'cal-route-frequency-row-muted': !group.inScope,
                'cal-route-frequency-row-striped': i % 2 === 1,
              }"
            >
              <td>{{ stopIdStr(row.stopId) }}</td>
              <td>{{ stopName(row.stopId) }}</td>
              <td>{{ row.directionId }}</td>
              <td>
                {{ row.departureCount }}
                <cat-tooltip
                  v-if="row.isRepresentativeStop"
                  text="Representative stop for the dominant direction — used for frequency calculation"
                >
                  <cat-icon icon="check" size="small" class="has-text-primary ml-1" />
                </cat-tooltip>
                <cat-tooltip
                  v-if="row.departureCount > row.tripCount"
                  :text="`${row.departureCount} departures here come from ${row.tripCount} trips, so some trips serve this stop more than once (for example a loop revisiting a point). These repeat visits can be useful to riders, but they are excluded from the route frequency calculation, where they would otherwise look like very short headways.`"
                >
                  <cat-icon icon="repeat" size="small" class="has-text-grey ml-1" />
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
import { computed } from 'vue'
import { format } from 'date-fns'
import type { Route } from '~~/src/tl'
import type { ScenarioFilterResult } from '~~/src/scenario'
import { resolveEffectiveWeekdays } from '~~/src/scenario'
import { timeWindowSeconds, formatGtfsTimeFull, formatDuration, formatServiceDate, dowValues } from '~~/src/core'
import type { Weekday, WeekdayMode } from '~~/src/core'
import {
  pickRepresentativeStop,
  pickDominantDirection,
  routeHeadways,
  computeHeadwaysPerDay,
  calculateRouteTripStats,
  buildRouteFrequencyCaveats,
  scopeDatesToWeekdays,
  oneDeparturePerTrip,
  distinctTripCount,
  summarizeGaps,
  WEEKDAY_BY_GETDAY,
  MIN_HEADWAY_SECONDS,
} from '~~/src/scenario/route-headway'
import { RouteDepartureIndex } from '~~/src/tl/departure-cache'
import type { TripDetailsTab } from './trip-details.vue'
import type { StopTimeCacheItem } from '~~/src/tl/departure-cache'

// The trip details tab this shows: the route's calculations, or its stops.
type Tab = Exclude<TripDetailsTab, 'trips'>

interface FrequencyRow {
  serviceDate: string
  tripId: number
  directionId: number
  stopId: number
  departureTime: number
  gapToNext?: number
  gapIsNoise: boolean
  inScope: boolean
}

const props = defineProps<{
  route: Route
  scenarioFilterResult: ScenarioFilterResult
  selectedDateRange: Date[]
  selectedWeekdays?: Weekday[]
  selectedWeekdayMode?: WeekdayMode
  startTime?: Date
  endTime?: Date
  tab: Tab
}>()

// The filter's own route index, so these numbers come from the same index as
// the report; built here only for a result made without one.
const routeIndex = computed(() =>
  props.scenarioFilterResult.routeIndex ?? RouteDepartureIndex.fromCache(props.scenarioFilterResult.stopDepartureCache),
)

const timeWindow = computed(() => timeWindowSeconds(props.startTime, props.endTime))
const startTimeSec = computed(() => timeWindow.value.startTime)
const endTimeSec = computed(() => timeWindow.value.endTime)

const chartStartHour = computed(() => Math.floor(startTimeSec.value / 3600))
const chartEndHour = computed(() => Math.ceil(endTimeSec.value / 3600))

const startTimeStr = computed(() =>
  props.startTime ? format(props.startTime, 'HH:mm:ss') : undefined,
)
const endTimeStr = computed(() =>
  props.endTime ? format(props.endTime, 'HH:mm:ss') : undefined,
)

// Scope the report-matching computations (frequency + trip stats) to the
// selected weekdays, exactly as scenario-filter does, so these numbers can
// never drift from the report. The per-date listings below still show every
// service day and tag out-of-scope dates via isDateInScope so the user can see
// what was excluded (issue #222).
const effectiveWeekdays = computed(() =>
  resolveEffectiveWeekdays(props.selectedWeekdays, props.selectedWeekdayMode),
)
const scopedDateRange = computed(() =>
  scopeDatesToWeekdays(props.selectedDateRange, effectiveWeekdays.value),
)
const scopedDateStrings = computed(() =>
  new Set(scopedDateRange.value.map(d => format(d, 'yyyy-MM-dd'))),
)
function isDateInScope (dateStr: string): boolean {
  return scopedDateStrings.value.has(dateStr)
}

// Labels derived from the canonical `dowValues` keys (e.g. 'monday') rather than
// hand-maintained tables: 'Monday' for the rollup, 'Mon' for the scope tag.
function weekdayLabel (d: Weekday): string {
  return d.charAt(0).toUpperCase() + d.slice(1)
}
function weekdayShort (d: Weekday): string {
  return d.charAt(0).toUpperCase() + d.slice(1, 3)
}
const weekdayScopeLabel = computed(() => {
  const ew = effectiveWeekdays.value
  if (ew == null || ew.length === 7) {
    return 'All days'
  }
  return dowValues.filter(d => ew.includes(d)).map(weekdayShort).join(', ')
})

// Go through the same `routeHeadways` path that scenario-filter uses, then pick
// the dominant direction via the shared helper — guarantees the UI can't drift
// from the actual frequency-calc direction.
const routeDeps = computed(() =>
  routeHeadways(
    props.route,
    scopedDateRange.value,
    startTimeStr.value,
    endTimeStr.value,
    routeIndex.value,
  ),
)

const dominantDirection = computed(() => pickDominantDirection(routeDeps.value))

// Frequency caveats (issue #368). Re-derived here via the same shared helper
// scenario-filter uses, so the modal's caveats can't drift from the route's
// stored flags.
const frequencyCaveats = computed(() => buildRouteFrequencyCaveats(routeDeps.value))

// Trip-count statistics — calls the same pure function that scenario-filter
// uses for average_trips_per_day / average_trips_per_hour / earliest-latest.
const tripStats = computed(() =>
  calculateRouteTripStats(
    props.route,
    scopedDateRange.value,
    startTimeStr.value,
    endTimeStr.value,
    routeIndex.value,
  ),
)

const isAllDayMode = computed(() => props.startTime == null && props.endTime == null)

const timeWindowLabel = computed(() =>
  isAllDayMode.value
    ? 'All day'
    : `${startTimeStr.value ?? '00:00:00'} to ${endTimeStr.value ?? '24:00:00'}`,
)

// Per-date frequency source: the dominant-direction representative stop and its
// in-window departures, deduped to one boarding departure per trip (issue #368).
// Both the Frequency view rows and the repeat-visit warning derive from this so
// they share one dedup-then-filter pass and can never disagree.
interface FrequencyDateData {
  serviceDate: string
  inScope: boolean
  repStopId: number
  // One boarding departure per trip, in the time window, sorted ascending —
  // the exact departures that feed average/fastest/slowest frequency.
  inWindow: StopTimeCacheItem[]
  // All representative-stop departures in the same window, before dedup. The
  // difference (rawInWindowCount - inWindow.length) is the repeat-visit count.
  rawInWindowCount: number
}

const frequencyByDate = computed<FrequencyDateData[]>(() => {
  const out: FrequencyDateData[] = []
  const dir = dominantDirection.value
  for (const d of props.selectedDateRange) {
    const dateStr = format(d, 'yyyy-MM-dd')
    const rep = pickRepresentativeStop(routeIndex.value, props.route.id, dir, dateStr)
    if (rep.stopId === undefined) {
      continue
    }
    const inWindow = oneDeparturePerTrip(rep.departures)
      .filter(st => st.departureTime >= startTimeSec.value && st.departureTime <= endTimeSec.value)
      .sort((a, b) => a.departureTime - b.departureTime)
    const rawInWindowCount = rep.departures.filter(
      st => st.departureTime >= startTimeSec.value && st.departureTime <= endTimeSec.value,
    ).length
    out.push({
      serviceDate: dateStr,
      inScope: isDateInScope(dateStr),
      repStopId: rep.stopId,
      inWindow,
      rawInWindowCount,
    })
  }
  return out
})

// Frequency Calculation view: every dominant-direction representative-stop
// departure across all selected service days, in the time-of-day window.
// These are the exact numbers that feed average/fastest/slowest frequency.
// Gap/noise classification is delegated to `computeHeadwaysPerDay` — the same
// helper that `calculateHeadwayStats` uses — so this view can never drift
// from the actual frequency calculation.
const frequencyRows = computed<FrequencyRow[]>(() => {
  const out: FrequencyRow[] = []
  const dir = dominantDirection.value
  for (const day of frequencyByDate.value) {
    // Shared helper returns one Headway<T> per consecutive pair; entry `i` is
    // the pair (inWindow[i], inWindow[i + 1]). Length is inWindow.length - 1.
    const headways = computeHeadwaysPerDay([day.inWindow], st => st.departureTime)
    for (let i = 0; i < day.inWindow.length; i++) {
      const st = day.inWindow[i]!
      const h = headways[i]
      out.push({
        serviceDate: day.serviceDate,
        tripId: st.tripId,
        directionId: dir,
        stopId: day.repStopId,
        departureTime: st.departureTime,
        gapToNext: h?.gap,
        gapIsNoise: h?.isNoise ?? false,
        inScope: day.inScope,
      })
    }
  }
  return out
})

// Count representative-stop departures excluded as repeat visits by the same
// trip (e.g. a loop terminal that is both first and last stop). Derived from
// the same dedup-then-filter pass as frequencyRows so the warning count can
// never disagree with the table (issue #368). Out-of-scope dates do not feed
// the statistics, so their repeats are not counted.
const repeatRepStopVisits = computed(() =>
  frequencyByDate.value.reduce(
    (sum, day) => sum + (day.inScope ? day.rawInWindowCount - day.inWindow.length : 0),
    0,
  ),
)

interface FrequencyDateGroup {
  serviceDate: string
  rows: FrequencyRow[]
  inScope: boolean
}

const frequencyDateGroups = computed<FrequencyDateGroup[]>(() => {
  const groups: FrequencyDateGroup[] = []
  let current: FrequencyDateGroup | undefined
  for (const row of frequencyRows.value) {
    if (!current || current.serviceDate !== row.serviceDate) {
      current = { serviceDate: row.serviceDate, rows: [], inScope: row.inScope }
      groups.push(current)
    }
    current.rows.push(row)
  }
  return groups
})

// Single source of truth for the rows that feed every summary statistic: only
// in-scope service days. Out-of-scope days are still listed per-date (and tagged
// excluded) but never contribute to the numbers, so the stats match the report
// (issue #222). All stat computeds and the hourly chart derive from this.
const inScopeFrequencyRows = computed(() => frequencyRows.value.filter(r => r.inScope))

// The exact array fed to calculateHeadwayStats: non-noise gaps from in-scope
// service days only, sorted ascending.
const contributingGaps = computed<number[]>(() => {
  const gaps = inScopeFrequencyRows.value
    .filter(r => r.gapToNext !== undefined && !r.gapIsNoise)
    .map(r => r.gapToNext!)
  gaps.sort((a, b) => a - b)
  return gaps
})

const gapStats = computed(() => {
  const summary = summarizeGaps(contributingGaps.value)
  if (!summary) {
    return undefined
  }
  // Indices to bold in the (already-sorted) contributingGaps list: the two
  // middle entries for even length, or the single middle entry for odd.
  const mid = Math.floor(summary.count / 2)
  const medianIndices = summary.count % 2 === 1
    ? new Set([mid])
    : new Set([mid - 1, mid])
  return { ...summary, medianIndices }
})

// Hourly chart reflects the same in-scope departures that feed the stats.
const chartDepartures = inScopeFrequencyRows

interface DowFrequencyRow {
  weekday: Weekday
  label: string
  count: number
  min: number
  median: number
  max: number
  avg: number
}

// Per-day-of-week breakdown of the contributing (in-scope, non-noise) gaps, so
// weekday vs weekend frequency differences are visible at a glance (issue #222).
// Ordering reuses the canonical Monday-first `dowValues`; the date→weekday and
// stat math reuse the shared route-headway helpers.
const dowFrequencyRollup = computed<DowFrequencyRow[]>(() => {
  const byWeekday = new Map<Weekday, number[]>()
  for (const row of inScopeFrequencyRows.value) {
    if (row.gapToNext === undefined || row.gapIsNoise) {
      continue
    }
    const [y, m, d] = row.serviceDate.split('-').map(Number)
    const weekday = WEEKDAY_BY_GETDAY[new Date(y!, m! - 1, d!).getDay()]
    if (weekday == null) {
      continue
    }
    const arr = byWeekday.get(weekday) ?? []
    arr.push(row.gapToNext)
    byWeekday.set(weekday, arr)
  }
  const out: DowFrequencyRow[] = []
  for (const weekday of dowValues) {
    const summary = summarizeGaps(byWeekday.get(weekday) ?? [])
    if (!summary) {
      continue
    }
    out.push({ weekday, label: weekdayLabel(weekday), ...summary })
  }
  return out
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

function scrollTo (id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function scrollToTop () {
  scrollTo('cal-route-frequency-top')
}

interface StopDetailRow {
  stopId: number
  directionId: number
  departureCount: number
  // Distinct trips serving the stop. When departureCount exceeds this, some
  // trips visit the stop more than once (e.g. a loop revisiting a point).
  tripCount: number
  isRepresentativeStop: boolean
}

interface StopDetailDateGroup {
  serviceDate: string
  rows: StopDetailRow[]
  inScope: boolean
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
          tripCount: distinctTripCount(deps),
          isRepresentativeStop: sid === rep.stopId && dir === dominant,
        })
      }
    }
    if (rows.length > 0) {
      rows.sort((a, b) => {
        const nameA = stopName(a.stopId)
        const nameB = stopName(b.stopId)
        return nameA.localeCompare(nameB) || a.directionId - b.directionId || b.departureCount - a.departureCount
      })
      groups.push({ serviceDate: dateStr, rows, inScope: isDateInScope(dateStr) })
    }
  }
  return groups
})

const stopDetailsCsvData = computed(() => {
  return stopDetailDateGroups.value.flatMap(group =>
    group.rows.map(row => ({
      service_date: group.serviceDate,
      in_scope: group.inScope,
      direction_id: row.directionId,
      stop_id: stopIdStr(row.stopId),
      stop_name: stopName(row.stopId),
      departure_count: row.departureCount,
      trip_count: row.tripCount,
      is_representative_stop: row.isRepresentativeStop,
    })),
  )
})

function stopIdStr (id: number): string {
  return stopsById.value.get(id)?.stop_id || String(id)
}

const routeIdPrefix = computed(() => props.route.route_short_name || props.route.route_id)

const frequencyCsvData = computed(() => {
  return frequencyRows.value.map(row => ({
    service_date: row.serviceDate,
    in_scope: row.inScope,
    direction_id: row.directionId,
    trip_id: tripIdLabel(row.tripId),
    stop_id: stopIdStr(row.stopId),
    stop_name: stopName(row.stopId),
    departure: formatGtfsTimeFull(row.departureTime),
    departure_seconds: row.departureTime,
    gap_to_next: row.gapToNext != null ? formatDuration(row.gapToNext) : '',
    gap_to_next_seconds: row.gapToNext ?? '',
    gap_is_noise: row.gapIsNoise,
  }))
})
</script>

<style scoped lang="scss">
.cal-route-frequency-gtfs-time {
  display: block;
  font-variant-numeric: tabular-nums;
}
.cal-route-frequency-trip-id {
  font-variant-numeric: tabular-nums;
  color: #666;
}
.cal-route-frequency-row-striped > td {
  background: var(--bulma-table-striped-row-even-background-color, #fafafa);
}
.cal-route-frequency-row-muted {
  opacity: 0.5;
}
.cal-route-frequency-row-excluded > td {
  font-style: italic;
  color: var(--bulma-grey, #7a7a7a);
}
.cal-route-frequency-dow-table {
  font-variant-numeric: tabular-nums;
  width: auto;
}
.cal-route-frequency-date-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}
.cal-route-frequency-date-nav-btn {
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
.cal-route-frequency-top-btn {
  background: none;
  border: none;
  padding: 0;
  margin-left: 0.75em;
  font: inherit;
  color: var(--bulma-grey, #7a7a7a);
  cursor: pointer;
  text-decoration: underline;
}
tbody + tbody > .cal-route-frequency-date-separator > td {
  border-top: 0.75em solid transparent;
}
.cal-route-frequency-date-separator > td {
  font-weight: 600;
  padding-top: 0.6em;
  padding-bottom: 0.4em;
  border-bottom: 1px solid var(--bulma-border, #dbdbdb);
}
.cal-route-frequency-noise-gap {
  font-variant-numeric: tabular-nums;
  color: #888;
  text-decoration: line-through;
}
.cal-route-frequency-gap-list {
  font-variant-numeric: tabular-nums;
  font-family: monospace;
  line-height: 1.6;
  word-spacing: 0.15rem;
}
.cal-route-frequency-gap-stats {
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
