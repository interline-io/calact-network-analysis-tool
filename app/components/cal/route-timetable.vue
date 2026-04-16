<template>
  <div class="cal-route-timetable">
    <header class="cal-route-timetable-header mb-4">
      <div class="has-text-weight-semibold">
        {{ props.route.route_short_name || props.route.route_id }}
        <span
          v-if="props.route.route_long_name && props.route.route_long_name !== props.route.route_short_name"
          class="has-text-weight-normal"
        >
          — {{ props.route.route_long_name }}
        </span>
      </div>
      <div class="has-text-grey">
        route_id: <code>{{ props.route.route_id }}</code>
      </div>
    </header>

    <cat-tabs v-model="activeTab" type="boxed">
      <cat-tab-item value="frequency" label="Frequency Calculation" />
      <cat-tab-item value="trips" label="Trip Timetable" />
    </cat-tabs>

    <!-- Trips view -->
    <div v-if="activeTab === 'trips'">
      <div class="cal-route-timetable-date-picker mb-4">
        <label class="mr-2">Service day:</label>
        <cat-select v-model="selectedDateStr" style="width: auto">
          <option
            v-for="opt in dateOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </cat-select>
      </div>

      <p v-if="!hasAnyRows" class="has-text-grey">
        No service on this date.
      </p>

      <section
        v-for="section in sections"
        :key="section.directionId"
        class="cal-route-timetable-section mb-5"
      >
        <h4 class="has-text-weight-bold">
          Direction {{ section.directionId }}
          <span
            v-if="section.directionId === dominantDirection"
            class="tag is-primary is-light ml-2"
          >
            Used for frequency
          </span>
        </h4>
        <table class="table is-fullwidth is-narrow is-striped cal-route-timetable-table cal-route-timetable-trips-table">
          <thead>
            <tr>
              <th>Trip ID</th>
              <th>First Stop</th>
              <th>Representative Stop</th>
              <th>Last Stop</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in section.rows"
              :key="row.tripId"
              :class="{ 'cal-route-timetable-row-muted': !row.inWindow }"
            >
              <td class="cal-route-timetable-trip-id">
                {{ tripIdLabel(row.tripId) }}
              </td>
              <td>
                <cat-tooltip
                  v-if="row.firstStopId !== section.representativeStopId"
                  :text="stopTooltip(row.firstStopId)"
                >
                  <span>{{ stopName(row.firstStopId) }}</span>
                  <span class="has-text-grey cal-route-timetable-gtfs-time">
                    {{ formatGtfsTimeFull(row.firstDepartureTime) }}
                  </span>
                </cat-tooltip>
                <span v-else class="has-text-grey-light">—</span>
              </td>
              <td>
                <cat-tooltip
                  v-if="section.representativeStopId != null"
                  :text="stopTooltip(section.representativeStopId)"
                >
                  <span>{{ stopName(section.representativeStopId) }}</span>
                  <span
                    v-if="row.repStopDepartureTime != null"
                    class="has-text-grey cal-route-timetable-gtfs-time"
                  >
                    {{ formatGtfsTimeFull(row.repStopDepartureTime) }}
                  </span>
                  <span v-else class="has-text-grey-light cal-route-timetable-gtfs-time">
                    —
                  </span>
                </cat-tooltip>
                <span v-else class="has-text-grey-light">—</span>
              </td>
              <td>
                <cat-tooltip
                  v-if="row.lastStopId !== section.representativeStopId"
                  :text="stopTooltip(row.lastStopId)"
                >
                  <span>{{ stopName(row.lastStopId) }}</span>
                  <span class="has-text-grey cal-route-timetable-gtfs-time">
                    {{ formatGtfsTimeFull(row.lastDepartureTime) }}
                  </span>
                </cat-tooltip>
                <span v-else class="has-text-grey-light">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Frequency Calculation view -->
    <div v-else-if="activeTab === 'frequency'">
      <p v-if="frequencyRows.length === 0" class="has-text-grey">
        No representative-stop departures contribute to the frequency calculation for this route in the selected filters.
      </p>

      <div v-else>
        <p class="mb-3 has-text-grey">
          Every dominant-direction representative-stop departure across the selected service days that feeds the average / fastest / slowest frequency calculation. Gaps under 2 minutes are shown struck through and excluded from the summary below.
        </p>

        <table class="table is-fullwidth is-narrow is-striped cal-route-timetable-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Service date</th>
              <th>Trip ID</th>
              <th>Dir</th>
              <th>Stop</th>
              <th>Departure</th>
              <th>Gap to next</th>
              <th>Gap (seconds)</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in frequencyRows"
              :key="i"
              :class="{ 'cal-route-timetable-day-break': i > 0 && row.serviceDate !== frequencyRows[i - 1]?.serviceDate }"
            >
              <td class="cal-route-timetable-trip-id">
                {{ i + 1 }}
              </td>
              <td>{{ row.serviceDate }}</td>
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
                <span v-if="row.gapToNext == null" class="has-text-grey-light">—</span>
                <cat-tooltip
                  v-else-if="row.gapIsNoise"
                  text="Gap below the 2-minute noise threshold; excluded from frequency calculation."
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
                <span v-if="row.gapToNext == null" class="has-text-grey-light">—</span>
                <span v-else-if="row.gapIsNoise" class="cal-route-timetable-noise-gap">
                  {{ row.gapToNext }}
                </span>
                <span v-else>{{ row.gapToNext }}</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="gapStats" class="cal-route-timetable-gap-summary mt-4">
          <div class="has-text-grey mb-1">
            Sorted contributing gaps (seconds) — min / median / max in bold:
          </div>
          <div class="cal-route-timetable-gap-list">
            <template v-for="(g, i) in contributingGaps" :key="i">
              <strong
                v-if="i === 0 || i === gapStats.medianIndex || i === contributingGaps.length - 1"
              >{{ g }}</strong>
              <template v-else>
                {{ g }}
              </template>
              <template v-if="i < contributingGaps.length - 1">
                ,
              </template>
            </template>
          </div>
          <dl class="cal-route-timetable-gap-stats mt-2">
            <div>
              <dt>Min:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.min) }}</strong>
                <span class="ml-3 has-text-grey-light">({{ gapStats.min }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Median:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.median) }}</strong>
                <span class="ml-3 has-text-grey-light">({{ gapStats.median }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Max:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.max) }}</strong>
                <span class="ml-3 has-text-grey-light">({{ gapStats.max }}s)</span>
              </dd>
            </div>
            <div>
              <dt>Average:</dt>
              <dd>
                <strong>{{ formatGtfsTimeFull(gapStats.avg) }}</strong>
                <span class="ml-3 has-text-grey-light">({{ gapStats.avg.toFixed(1) }}s)</span>
                <span class="has-text-grey"> — n = {{ gapStats.count }}</span>
              </dd>
            </div>
          </dl>
        </div>
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
import {
  pickRepresentativeStop,
  pickDominantDirection,
  routeHeadways,
  computeHeadwaysPerDay,
} from '~~/src/scenario/route-headway'
import { RouteDepartureIndex } from '~~/src/tl/departure-cache'

type Tab = 'trips' | 'frequency'

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

const selectedDateStr = ref<string>(
  props.selectedDateRange[0] ? format(props.selectedDateRange[0], 'yyyy-MM-dd') : '',
)

const dateOptions = computed(() => {
  return props.selectedDateRange.map((d) => {
    const value = format(d, 'yyyy-MM-dd')
    // Example: "Mon 2024-01-15"
    const label = format(d, 'EEE yyyy-MM-dd')
    return { value, label }
  })
})

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

const timetable = computed(() =>
  buildRouteTimetable(
    props.route,
    selectedDateStr.value,
    startTimeSec.value,
    endTimeSec.value,
    routeIndex.value,
  ),
)

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

const sections = computed(() => {
  return [timetable.value.dir0, timetable.value.dir1].filter(s => s.rows.length > 0)
})

const hasAnyRows = computed(() => sections.value.length > 0)

const activeTab = ref<Tab>(props.initialTab ?? 'frequency')

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
  const medianIndex = Math.floor(gaps.length / 2)
  const median = gaps[medianIndex]!
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
  return { min, max, median, medianIndex, avg, count: gaps.length }
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

function formatGtfsTimeFull (seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return ''
  }
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

function pad (n: number): string {
  return n.toString().padStart(2, '0')
}
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
.cal-route-timetable-row-muted {
  opacity: 0.5;
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
