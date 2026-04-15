/**
 * Route Headway Calculation Module
 *
 * This module calculates departure times and headways for transit routes.
 * Headways (time intervals between consecutive departures) are used to
 * determine service frequency for filtering and display.
 */

import { format } from 'date-fns'
import { parseHMS, type Weekday } from '../core'
import type {
  Route,
  StopTimeCacheItem,
  RouteDepartureIndex,
} from '../tl'

// Maps JS Date.getDay() (0=Sun..6=Sat) to the Weekday string keys. Kept local
// because `dowValues` in src/core/constants.ts starts at monday, not sunday.
const WEEKDAY_BY_GETDAY: readonly Weekday[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const

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
      // Pick the representative stop (the one with the most departures) for
      // this (route, direction, date).
      let stopDepartures: StopTimeCacheItem[] = []
      const formattedDate = format(d, 'yyyy-MM-dd')
      const dateStopDeps = routeIndex.getRouteDate(route.id, dir, formattedDate)
      for (const deps of dateStopDeps.values()) {
        if (deps.length > stopDepartures.length) {
          stopDepartures = deps
        }
      }

      // Filter by time window (departureTime is already in seconds) and sort.
      const stSecs = stopDepartures
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
 * Statistics about trips on a route across the selected date range.
 *
 * In specific-hours mode, only trips with at least one stop_time in the selected
 * window are "included." Included trips contribute their *full* span to
 * earliestTripStart/End and latestTripStart/End — not just the in-window portion.
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
 * For each date, iterates every stop_time across both directions and all stops,
 * tracking per-trip:
 * - min/max `departureTime` across ALL the trip's stop_times (the trip's full span)
 * - whether at least one stop_time falls within the selected time window
 *
 * A trip is "included" iff it has any stop_time in window. Included trips contribute
 * their full span to earliest/latest. This matches the issue's tooltip language:
 * "the 24-hour time at which the first visit at a stop that begins a trip happens."
 *
 * @param route - The route to analyze
 * @param selectedDateRange - Array of dates to include
 * @param selectedStartTime - Start of time window (HH:MM:SS)
 * @param selectedEndTime - End of time window (HH:MM:SS)
 * @param routeIndex - Route departure index for lookups
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
    // For each trip: track its full span (across ALL stop_times) and whether
    // any stop_time falls in the selected window.
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
const MIN_HEADWAY_SECONDS = 2 * 60

/**
 * Calculate headway statistics from per-day departure arrays.
 * Headways are computed within each day and then aggregated, so an interval
 * is never measured between trips on different service days.
 * Headways under 2 minutes are filtered out as noise.
 *
 * @param departuresByDay - Each inner array is one date's departure times in seconds since midnight
 * @returns Object with average, fastest (min), and slowest (max) headways in seconds, or undefined if no qualifying intervals
 */
export function calculateHeadwayStats (departuresByDay: number[][]): {
  average: number
  fastest: number
  slowest: number
} | undefined {
  const headways: number[] = []
  for (const dayDepartures of departuresByDay) {
    if (dayDepartures.length < 2) {
      continue
    }
    const sorted = [...dayDepartures].sort((a, b) => a - b)
    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i]
      const next = sorted[i + 1]
      if (curr !== undefined && next !== undefined) {
        const headway = next - curr
        // Filter out headways under 2 minutes as noise
        if (headway >= MIN_HEADWAY_SECONDS) {
          headways.push(headway)
        }
      }
    }
  }

  if (headways.length === 0) {
    return undefined
  }

  headways.sort((a, b) => a - b)

  return {
    average: headways.reduce((a, b) => a + b) / headways.length,
    fastest: headways[0]!,
    slowest: headways[headways.length - 1]!
  }
}
