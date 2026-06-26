/**
 * Route Headway Calculation Module
 *
 * This module calculates departure times and headways for transit routes.
 * Headways (time intervals between consecutive departures) are used to
 * determine service frequency for filtering and display.
 */

import { format } from 'date-fns'
import {
  parseHMS,
  MIN_HEADWAY_SECONDS,
  IRREGULAR_HEADWAY_RATIO,
  IRREGULAR_MIN_LARGEST_GAP_SECONDS,
  MIN_GAPS_FOR_IRREGULAR,
  FREQUENCY_DIRECTION_DIVERGENCE_RATIO,
  WEEKDAY_BY_GETDAY,
  type Weekday,
} from '../core'
import type {
  Route,
  StopTimeCacheItem,
  RouteDepartureIndex,
} from '../tl'

/**
 * Per-direction, per-date in-window departures at each day's representative stop.
 *
 * Each inner array corresponds positionally to `selectedDateRange[i]` — i.e.
 * `dir0[i]` holds direction-0 departures for the i-th date in the range, at
 * whichever stop was the representative stop for that (route, direction, date).
 * Empty inner arrays are kept on service-less days to preserve the positional
 * mapping.
 */
export type RouteDepartures = {
  dir0: number[][]
  dir1: number[][]
}

/**
 * Calculate departure times for a route across the selected date range and time window.
 *
 * For each direction (0 and 1) and each date in the range:
 * 1. Find the "representative stop" — the stop with the most departures for this route/direction/date.
 * 2. Get all departure times at that stop, filtered to the selected time window.
 * 3. Append the sorted times (in seconds since midnight) as a per-date inner array.
 *
 * Preserving the per-day boundary (rather than flattening) ensures that downstream
 * consumers (`calculateHeadwayStats`, weekday-service checks) never treat the gap
 * between trips on different service days as an interval.
 *
 * @param route - The route to analyze
 * @param selectedDateRange - Array of dates to include
 * @param selectedStartTime - Start of time window (HH:MM:SS), defaults to 00:00:00
 * @param selectedEndTime - End of time window (HH:MM:SS), defaults to 24:00:00
 * @param routeIndex - Route departure index for lookups
 * @returns RouteDepartures — dir0/dir1 as parallel arrays to selectedDateRange
 */
export function routeHeadways (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  routeIndex?: RouteDepartureIndex
): RouteDepartures {
  if (!routeIndex) {
    // Preserve the positional-alignment contract even in the no-index case.
    return {
      dir0: selectedDateRange.map(() => []),
      dir1: selectedDateRange.map(() => []),
    }
  }
  const result: RouteDepartures = { dir0: [], dir1: [] }
  const startTime = parseHMS(selectedStartTime || '00:00:00')
  const endTime = parseHMS(selectedEndTime || '24:00:00')
  for (const dir of [0, 1]) {
    const bucket = dir ? result.dir1 : result.dir0
    for (const d of selectedDateRange) {
      const formattedDate = format(d, 'yyyy-MM-dd')
      const rep = pickRepresentativeStop(routeIndex, route.id, dir, formattedDate)

      // Collapse repeat visits by the same trip (loop terminals) to one
      // departure per trip before measuring headways (issue #368), then filter
      // by time window (departureTime is already in seconds) and sort.
      const stSecs = oneDeparturePerTrip(rep.departures)
        .map(st => st.departureTime)
        .filter(depTime => depTime >= 0 && depTime >= startTime && depTime <= endTime)
      stSecs.sort((a, b) => a - b)

      // Always push, even when empty, to keep the positional mapping to
      // selectedDateRange[i] intact.
      bucket.push(stSecs)
    }
  }
  return result
}

/**
 * For a (route, direction, date) bucket in the index, pick the "representative"
 * stop — the in-bbox stop with the most departures — and return both its stopId
 * and its stop_times. Returns stopId = undefined when the bucket is empty.
 *
 * The returned `departures` are RAW: a loop terminal lists each trip twice
 * (outbound start plus inbound return). Headway/frequency consumers must
 * collapse them with `oneDeparturePerTrip` first (otherwise the loop turnaround
 * looks like a short headway — issue #368); callers that genuinely want the
 * raw per-visit count (e.g. Stop Details) use them as-is.
 *
 * Tie-breaking: when two stops have the same departure count, the lower
 * numeric stop ID wins. Deterministic regardless of Map insertion order.
 */
export function pickRepresentativeStop (
  routeIndex: RouteDepartureIndex,
  routeId: number,
  dir: number,
  formattedDate: string,
): { stopId?: number, departures: StopTimeCacheItem[] } {
  let stopId: number | undefined
  let departures: StopTimeCacheItem[] = []
  const dateStopDeps = routeIndex.getRouteDate(routeId, dir, formattedDate)
  for (const [sid, deps] of dateStopDeps.entries()) {
    if (deps.length > departures.length || (deps.length === departures.length && stopId !== undefined && sid < stopId)) {
      stopId = sid
      departures = deps
    }
  }
  return { stopId, departures }
}

/**
 * Pick the visit that better represents a trip's boarding departure at a stop.
 * A visit with `pickup_type === 1` ("no pickup available") is drop-off only,
 * e.g. a loop's return to its terminal, so a boardable visit is always
 * preferred. Among visits of equal boardability the earlier one wins. When
 * `pickup_type` is null (the feed omits it) every visit is boardable, so this
 * reduces to "earliest wins".
 */
function preferDeparture (a: StopTimeCacheItem, b: StopTimeCacheItem): StopTimeCacheItem {
  const aBoardable = a.pickupType !== 1
  const bBoardable = b.pickupType !== 1
  if (aBoardable !== bBoardable) {
    return aBoardable ? a : b
  }
  return b.departureTime < a.departureTime ? b : a
}

/**
 * Reduce a stop's departures to one per trip: the trip's boarding departure at
 * that stop. A loop route whose representative stop is the start-and-end
 * terminal lists each trip twice (outbound start plus inbound return); counting
 * both inflates the departure list and injects spurious short gaps into the
 * headway calculation (issue #368). Keeping one departure per trip yields the
 * true headway between consecutive trips.
 *
 * When `pickup_type` is available the boardable visit is chosen (so a drop-off
 * return is excluded even if it sorts earlier); otherwise the earliest visit is
 * used. A trip with only drop-off visits still contributes its earliest one, so
 * no trip is dropped. A no-op for normal routes, where each trip visits a stop
 * once.
 */
export function oneDeparturePerTrip (departures: StopTimeCacheItem[]): StopTimeCacheItem[] {
  const chosenByTrip = new Map<number, StopTimeCacheItem>()
  for (const st of departures) {
    const cur = chosenByTrip.get(st.tripId)
    chosenByTrip.set(st.tripId, cur === undefined ? st : preferDeparture(cur, st))
  }
  return [...chosenByTrip.values()]
}

/**
 * Count the distinct trips among a stop's departures. Equivalent to
 * `oneDeparturePerTrip(departures).length` but without building the deduped
 * array or running the boardability tie-break — used where only the count is
 * needed (e.g. flagging stops some trip visits more than once). When this is
 * less than the raw departure count, a trip serves the stop more than once
 * (e.g. a loop revisiting a point).
 */
export function distinctTripCount (departures: StopTimeCacheItem[]): number {
  const trips = new Set<number>()
  for (const st of departures) {
    trips.add(st.tripId)
  }
  return trips.size
}

/**
 * Does this route have any in-window service on the given weekday across the
 * selected date range? True if at least one date in `selectedDateRange` whose
 * day-of-week matches `target` has a non-empty departures array in either
 * direction.
 */
export function hasServiceOnWeekday (
  deps: RouteDepartures,
  selectedDateRange: Date[],
  target: Weekday
): boolean {
  for (let i = 0; i < selectedDateRange.length; i++) {
    if (WEEKDAY_BY_GETDAY[selectedDateRange[i]!.getDay()] !== target) {
      continue
    }
    if ((deps.dir0[i]?.length ?? 0) > 0 || (deps.dir1[i]?.length ?? 0) > 0) {
      return true
    }
  }
  return false
}

/**
 * Filter a date range to the dates whose weekday is in `effectiveWeekdays`.
 * When `effectiveWeekdays` is undefined (no weekday subset selected), the range
 * is returned unchanged. Shared by scenario-filter (route frequency and trip
 * stats) and the Route Timetable debug modal so the two cannot diverge on which
 * service days feed the numbers (issue #222).
 */
export function scopeDatesToWeekdays (dates: Date[], effectiveWeekdays?: Weekday[]): Date[] {
  if (effectiveWeekdays == null) {
    return dates
  }
  return dates.filter((d) => {
    const dow = WEEKDAY_BY_GETDAY[d.getDay()]
    return dow != null && effectiveWeekdays.includes(dow)
  })
}

/**
 * Statistics about trips on a route across the selected date range.
 */
export interface RouteTripStats {
  tripCount: number // included trips across all dates in range
  dateCount: number // calendar days in selectedDateRange (NOT service days)
  hoursInWindow: number // (endSeconds - startSeconds) / 3600; 24 in all-day mode
  averageTripsPerDay: number // tripCount / dateCount
  averageTripsPerHour: number // tripCount / (hoursInWindow * dateCount)
  earliestTripStart?: number // seconds since midnight
  earliestTripEnd?: number
  latestTripStart?: number
  latestTripEnd?: number
}

/**
 * Calculate trip-level statistics for a route across the selected date range.
 *
 * For each date, iterates every in-bbox stop_time across both directions, tracking
 * per-trip:
 * - min/max `departureTime` across all of the trip's in-bbox stop_times
 * - whether at least one stop_time falls within the selected time-of-day window
 *
 * A trip is "included" iff it has any stop_time in the time-of-day window. Included
 * trips contribute their full in-bbox span (not just the in-window portion) to
 * earliestTripStart/End and latestTripStart/End. Since `routeIndex` is built from
 * `StopDepartureCache`, which only holds departures for stops fetched within the
 * bbox, trips whose true origin or terminus is at a stop outside the bbox report
 * their first/last in-bbox departure instead.
 *
 * @param route - The route to analyze
 * @param selectedDateRange - Array of dates to include
 * @param selectedStartTime - Start of time-of-day window (HH:MM:SS)
 * @param selectedEndTime - End of time-of-day window (HH:MM:SS)
 * @param routeIndex - Route departure index for lookups (already bbox-filtered)
 */
export function calculateRouteTripStats (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  routeIndex?: RouteDepartureIndex
): RouteTripStats | undefined {
  if (!routeIndex) {
    return undefined
  }
  const startTime = parseHMS(selectedStartTime || '00:00:00')
  const endTime = parseHMS(selectedEndTime || '24:00:00')
  const hoursInWindow = (endTime - startTime) / 3600

  // Denominator for averages is the number of calendar days in the selected
  // range, not the number of days on which this route has service. This matches
  // the issue's wording ("divided by the number of calendar days included
  // within the current filters") and keeps the average comparable across routes
  // regardless of each route's service pattern.
  const dateCount = selectedDateRange.length
  let totalTrips = 0
  let earliestTripStart: number | undefined
  let earliestTripEnd: number | undefined
  let latestTripStart: number | undefined
  let latestTripEnd: number | undefined

  for (const d of selectedDateRange) {
    const formattedDate = format(d, 'yyyy-MM-dd')
    // For each trip: track its full in-bbox span and whether any stop_time
    // falls in the selected time-of-day window. The span is NOT the trip's
    // literal origin-to-terminus — stop_times for stops outside the bbox
    // are absent from the index.
    const tripTimes = new Map<number, { min: number, max: number, inWindow: boolean }>()

    for (const dir of [0, 1]) {
      const dateStopDeps = routeIndex.getRouteDate(route.id, dir, formattedDate)
      for (const deps of dateStopDeps.values()) {
        for (const st of deps) {
          const inWindow = st.departureTime >= startTime && st.departureTime <= endTime
          const existing = tripTimes.get(st.tripId)
          if (existing) {
            existing.min = Math.min(existing.min, st.departureTime)
            existing.max = Math.max(existing.max, st.departureTime)
            if (inWindow) {
              existing.inWindow = true
            }
          } else {
            tripTimes.set(st.tripId, { min: st.departureTime, max: st.departureTime, inWindow })
          }
        }
      }
    }

    for (const t of tripTimes.values()) {
      if (!t.inWindow) {
        continue
      }
      totalTrips++
      if (earliestTripStart === undefined || t.min < earliestTripStart) {
        earliestTripStart = t.min
      }
      if (latestTripStart === undefined || t.min > latestTripStart) {
        latestTripStart = t.min
      }
      if (earliestTripEnd === undefined || t.max < earliestTripEnd) {
        earliestTripEnd = t.max
      }
      if (latestTripEnd === undefined || t.max > latestTripEnd) {
        latestTripEnd = t.max
      }
    }
  }

  if (dateCount === 0 || totalTrips === 0) {
    return undefined
  }

  const averageTripsPerDay = totalTrips / dateCount
  const averageTripsPerHour = hoursInWindow > 0 ? totalTrips / (hoursInWindow * dateCount) : 0

  return {
    tripCount: totalTrips,
    dateCount,
    hoursInWindow,
    averageTripsPerDay,
    averageTripsPerHour,
    earliestTripStart,
    earliestTripEnd,
    latestTripStart,
    latestTripEnd,
  }
}

// Minimum headway threshold (2 minutes in seconds)
// Headways below this are filtered out as noise (e.g., bunched buses during peak demand)
// Re-export so existing consumers (tests, UI) can still import from this module.
// WEEKDAY_BY_GETDAY lives in core (used app-wide) but rides along here so the
// Route Timetable debug view keeps importing the frequency bundle from one place.
export { MIN_HEADWAY_SECONDS, WEEKDAY_BY_GETDAY } from '../core'

/**
 * A headway (interval) between two consecutive departures within the same
 * service day. Generic over the underlying item type so both numeric and
 * rich-record callers (e.g. UIs that need tripId + stopId alongside the time)
 * can share one implementation.
 */
export interface Headway<T> {
  from: T
  to: T
  gap: number
  isNoise: boolean
}

/**
 * For a per-day array of departure records (sorted ascending by time), return
 * every consecutive-pair interval. Cross-day pairs are never produced. Gaps
 * under MIN_HEADWAY_SECONDS are flagged (`isNoise: true`) but still returned —
 * callers that want only the contributing intervals should filter.
 */
export function computeHeadwaysPerDay<T> (
  perDay: readonly T[][],
  getTime: (item: T) => number,
): Array<Headway<T>> {
  const out: Array<Headway<T>> = []
  for (const day of perDay) {
    for (let i = 0; i < day.length - 1; i++) {
      const from = day[i]!
      const to = day[i + 1]!
      const gap = getTime(to) - getTime(from)
      out.push({ from, to, gap, isNoise: gap < MIN_HEADWAY_SECONDS })
    }
  }
  return out
}

/**
 * Pick the dominant direction from a `RouteDepartures` set. The direction with
 * more total in-window rep-stop departures wins; ties go to direction 0.
 * Shared by scenario-filter (which then takes that direction's departures into
 * `calculateHeadwayStats`) and the Route Timetable debug UI.
 */
export function pickDominantDirection (deps: RouteDepartures): 0 | 1 {
  const dir0Count = deps.dir0.reduce((sum, d) => sum + d.length, 0)
  const dir1Count = deps.dir1.reduce((sum, d) => sum + d.length, 0)
  return dir1Count > dir0Count ? 1 : 0
}

/**
 * Summary statistics over a set of headway gaps (seconds). Callers collect the
 * contributing gaps; this performs the min/median/max/average math shared by
 * `calculateHeadwayStats` and the Route Timetable debug views (overall and
 * per-weekday) so the implementations can never disagree on how a
 * representative frequency is derived. Returns undefined for an empty input.
 */
export interface GapSummary {
  min: number
  median: number
  max: number
  avg: number
  count: number
}

export function summarizeGaps (gaps: readonly number[]): GapSummary | undefined {
  if (gaps.length === 0) {
    return undefined
  }
  const sorted = [...gaps].sort((a, b) => a - b)
  const count = sorted.length
  const mid = Math.floor(count / 2)
  const median = count % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
  const avg = sorted.reduce((a, b) => a + b, 0) / count
  return { min: sorted[0]!, median, max: sorted[count - 1]!, avg, count }
}

/**
 * Calculate headway statistics from per-day departure arrays.
 * Headways are computed within each day and then aggregated, so an interval
 * is never measured between trips on different service days.
 * Headways under MIN_HEADWAY_SECONDS are filtered out as noise.
 *
 * @param departuresByDay - Each inner array is one date's departure times in seconds since midnight
 * @returns Object with average, fastest (min), and slowest (max) headways in seconds, or undefined if no qualifying intervals
 */
export function calculateHeadwayStats (departuresByDay: number[][]): {
  average: number
  fastest: number
  slowest: number
} | undefined {
  const sortedByDay = departuresByDay.map(day => [...day].sort((a, b) => a - b))
  const headways = computeHeadwaysPerDay(sortedByDay, n => n)
  const contributing: number[] = []
  for (const h of headways) {
    if (!h.isNoise) {
      contributing.push(h.gap)
    }
  }
  const summary = summarizeGaps(contributing)
  if (!summary) {
    return undefined
  }
  return {
    average: summary.avg,
    fastest: summary.min,
    slowest: summary.max,
  }
}

/**
 * Frequency caveats for a route (issue #368). Both flags derive from the same
 * windowed RouteDepartures that feed the reported average/fastest/slowest, so
 * they stay consistent with the numbers the tool shows. `gapSummary` and
 * `comparison` are returned so the debug modal can show the supporting figures
 * without recomputing.
 */
export interface DirectionFrequencyComparison {
  dir0Average?: number
  dir1Average?: number
  dominantDirection: 0 | 1
  dominantAverage?: number
  otherAverage?: number
  ratio?: number // larger / smaller average, when both are defined
  directionsDifferMaterially: boolean
}

export interface RouteFrequencyCaveats {
  // Headways aren't stable across the day — the reported average isn't
  // representative (commuter/peak, school trippers, midday gaps, etc.).
  irregular: boolean
  // The two directions run at materially different frequencies, but the
  // reported number covers only the dominant direction.
  directionsDifferMaterially: boolean
  gapSummary?: GapSummary
  comparison: DirectionFrequencyComparison
}

/**
 * Summarize the dominant direction's contributing (non-noise) headway gaps —
 * the exact gaps behind average/fastest/slowest, but also exposing median and
 * count so callers can judge variability. Returns undefined when there are no
 * qualifying gaps.
 */
export function dominantGapSummary (deps: RouteDepartures): GapSummary | undefined {
  const dominant = pickDominantDirection(deps)
  const perDay = (dominant === 1 ? deps.dir1 : deps.dir0).map(day => [...day].sort((a, b) => a - b))
  const headways = computeHeadwaysPerDay(perDay, n => n)
  const contributing: number[] = []
  for (const h of headways) {
    if (!h.isNoise) {
      contributing.push(h.gap)
    }
  }
  return summarizeGaps(contributing)
}

/**
 * Generic "irregular service" test: the longest contributing gap is both (a) at
 * least IRREGULAR_HEADWAY_RATIO times the median gap and (b) a real multi-hour
 * service break (>= IRREGULAR_MIN_LARGEST_GAP_SECONDS), given enough gaps to
 * judge. A stable route has max ≈ median (low ratio); a commuter/school/
 * time-concentrated route has a long break in the middle of the day. The
 * absolute floor keeps a frequent all-day route with one stretched early/late
 * gap from being flagged. Kept deliberately generic rather than tuned to any
 * single service pattern.
 */
export function isIrregularHeadway (summary: GapSummary | undefined): boolean {
  return (
    !!summary
    && summary.count >= MIN_GAPS_FOR_IRREGULAR
    && summary.median > 0
    && summary.max >= summary.median * IRREGULAR_HEADWAY_RATIO
    && summary.max >= IRREGULAR_MIN_LARGEST_GAP_SECONDS
  )
}

/**
 * Compare the two directions' average headways from a windowed RouteDepartures.
 * Reuses calculateHeadwayStats per direction so each number matches what the
 * dominant direction would report. `directionsDifferMaterially` is true only
 * when BOTH directions have a defined average and the larger exceeds the
 * smaller by more than FREQUENCY_DIRECTION_DIVERGENCE_RATIO — a one-way loop, a
 * single-trip direction, or a direction with no in-window service is not flagged.
 */
export function compareDirectionFrequencies (deps: RouteDepartures): DirectionFrequencyComparison {
  const dominantDirection = pickDominantDirection(deps)
  const dir0Average = calculateHeadwayStats(deps.dir0)?.average
  const dir1Average = calculateHeadwayStats(deps.dir1)?.average
  const dominantAverage = dominantDirection === 1 ? dir1Average : dir0Average
  const otherAverage = dominantDirection === 1 ? dir0Average : dir1Average

  let ratio: number | undefined
  let directionsDifferMaterially = false
  if (dir0Average != null && dir1Average != null && dir0Average > 0 && dir1Average > 0) {
    const hi = Math.max(dir0Average, dir1Average)
    const lo = Math.min(dir0Average, dir1Average)
    ratio = hi / lo
    directionsDifferMaterially = ratio > FREQUENCY_DIRECTION_DIVERGENCE_RATIO
  }

  return {
    dir0Average,
    dir1Average,
    dominantDirection,
    dominantAverage,
    otherAverage,
    ratio,
    directionsDifferMaterially,
  }
}

/**
 * Build the route's frequency caveats from a windowed RouteDepartures. Pure;
 * called by scenario-filter (to store booleans on the route) and by the Route
 * Timetable debug modal (to render the explanation) so the two cannot drift.
 */
export function buildRouteFrequencyCaveats (deps: RouteDepartures): RouteFrequencyCaveats {
  const gapSummary = dominantGapSummary(deps)
  const comparison = compareDirectionFrequencies(deps)
  return {
    irregular: isIrregularHeadway(gapSummary),
    directionsDifferMaterially: comparison.directionsDifferMaterially,
    gapSummary,
    comparison,
  }
}
