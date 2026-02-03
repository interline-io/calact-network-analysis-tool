/**
 * Route Headway Calculation Module
 *
 * This module calculates departure times and headways for transit routes.
 * Headways (time intervals between consecutive departures) are used to
 * determine service frequency for filtering and display.
 */

import { format } from 'date-fns'
import { parseHMS } from '../core'
import type {
  Route,
  RouteHeadwayDirections,
  RouteHeadwaySummary,
  RouteDepartureIndex,
} from '../tl'

/**
 * Calculate departure times for a route across the selected date range and time window.
 *
 * For each direction (0 and 1) and each date in the range:
 * 1. Find the "representative stop" - the stop with the most departures for this route/direction/date
 * 2. Get all departure times at that stop, filtered to the selected time window
 * 3. Store the departure times (in seconds since midnight) in the result
 *
 * Results are aggregated into:
 * - total: all departures across all dates (for overall frequency calculation)
 * - Per day-of-week buckets (sunday, monday, etc.): for day-specific filtering
 *
 * The departure times can later be used to:
 * - Check if a route has any service on selected days (departures.length > 0)
 * - Calculate headways/frequency by computing intervals between consecutive departures
 *
 * @param route - The route to analyze
 * @param selectedDateRange - Array of dates to include
 * @param selectedStartTime - Start of time window (HH:MM:SS), defaults to 00:00:00
 * @param selectedEndTime - End of time window (HH:MM:SS), defaults to 24:00:00
 * @param sdCache - Stop departure cache containing pre-fetched departure data
 * @returns RouteHeadwaySummary with departure times organized by direction and day-of-week
 */
export function routeHeadways (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime?: string,
  selectedEndTime?: string,
  routeIndex?: RouteDepartureIndex
): RouteHeadwaySummary {
  const result = newRouteHeadwaySummary()
  if (!routeIndex) {
    return result
  }
  const startTime = parseHMS(selectedStartTime || '00:00:00')
  const endTime = parseHMS(selectedEndTime || '24:00:00')
  for (const dir of [0, 1]) {
    for (const d of selectedDateRange) {
      // Get the stop with the most departures
      let stopId: number = 0
      let stopDepartures: number[] = []
      const formattedDate = format(d, 'yyyy-MM-dd')
      const dateStopDeps = routeIndex.getRouteDate(route.id, dir, formattedDate)
      for (const [depStopId, deps] of dateStopDeps.entries()) {
        if (deps.length > stopDepartures.length) {
          stopId = depStopId
          stopDepartures = deps
        }
      }

      // Filter by time window (departures are already in seconds)
      const stSecs = stopDepartures
        .filter(depTime => depTime >= startTime && depTime <= endTime)
      stSecs.sort((a, b) => a - b)

      // Add to result
      const resultDir = dir ? result.total.dir1 : result.total.dir0
      resultDir.stop_id = stopId
      resultDir.departures.push(...stSecs)

      let resultDay: RouteHeadwayDirections | undefined
      switch (d.getDay()) {
        case 0:
          resultDay = result.sunday
          break
        case 1:
          resultDay = result.monday
          break
        case 2:
          resultDay = result.tuesday
          break
        case 3:
          resultDay = result.wednesday
          break
        case 4:
          resultDay = result.thursday
          break
        case 5:
          resultDay = result.friday
          break
        case 6:
          resultDay = result.saturday
          break
      }
      if (resultDay != undefined) {
        const dayDir = dir ? resultDay.dir1 : resultDay.dir0
        dayDir.stop_id = stopId
        dayDir.departures.push(...stSecs)
      }
    }
  }
  return result
}

/**
 * Create a new empty RouteHeadwaySummary with all days initialized.
 */
export function newRouteHeadwaySummary (): RouteHeadwaySummary {
  return {
    total: newRouteHeadwayDirections(),
    sunday: newRouteHeadwayDirections(),
    monday: newRouteHeadwayDirections(),
    tuesday: newRouteHeadwayDirections(),
    wednesday: newRouteHeadwayDirections(),
    thursday: newRouteHeadwayDirections(),
    friday: newRouteHeadwayDirections(),
    saturday: newRouteHeadwayDirections(),
  }
}

/**
 * Create a new empty RouteHeadwayDirections with both directions initialized.
 */
export function newRouteHeadwayDirections () {
  return {
    dir0: { stop_id: 0, departures: [] },
    dir1: { stop_id: 0, departures: [] }
  }
}

// Minimum headway threshold (2 minutes in seconds)
// Headways below this are filtered out as noise (e.g., bunched buses during peak demand)
const MIN_HEADWAY_SECONDS = 2 * 60

/**
 * Calculate headway statistics from an array of departure times.
 * Headways are the time intervals between consecutive departures.
 * Headways under 2 minutes are filtered out as noise.
 *
 * @param departures - Array of departure times in seconds since midnight
 * @returns Object with average, fastest (min), and slowest (max) headways in seconds, or undefined if < 2 departures
 */
export function calculateHeadwayStats (departures: number[]): {
  average: number
  fastest: number
  slowest: number
} | undefined {
  if (departures.length < 2) {
    return undefined
  }

  // Sort departures ascending before calculating headways
  const sorted = [...departures].sort((a, b) => a - b)

  const headways: number[] = []
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
