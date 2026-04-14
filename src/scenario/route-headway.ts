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
  const result: RouteDepartures = { dir0: [], dir1: [] }
  if (!routeIndex) {
    return result
  }
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
