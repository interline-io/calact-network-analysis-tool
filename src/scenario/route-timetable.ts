/**
 * Per-date, per-direction trip timetable for a route.
 *
 * Used by the Route Timetable debug modal to expose every trip that went into
 * the Routes report calculations — trip count, earliest/latest trip start/end,
 * and (via `representativeStopId`) the frequency stats.
 */

import { format } from 'date-fns'
import type { RouteDepartureIndex } from '../tl/departure-cache'
import type { Route } from '../tl/route'
import { pickRepresentativeStop, routeHeadways } from './route-headway'

export interface TimetableRow {
  tripId: number
  directionId: number
  firstStopId: number
  firstDepartureTime: number
  lastStopId: number
  lastDepartureTime: number
  // Earliest departure at the direction's representative stop, if this trip
  // visits it. A loop route may visit the rep stop multiple times — the
  // earliest hit is reported.
  repStopDepartureTime?: number
  // True if ≥1 of this trip's in-bbox stop_times falls in the time-of-day
  // window. Matches the inclusion rule used by calculateRouteTripStats.
  inWindow: boolean
}

export interface DirectionTimetable {
  directionId: number
  representativeStopId?: number
  rows: TimetableRow[]
}

export interface RouteTimetable {
  dir0: DirectionTimetable
  dir1: DirectionTimetable
}

export function buildRouteTimetable (
  route: Route,
  formattedDate: string,
  startTimeSec: number,
  endTimeSec: number,
  routeIndex: RouteDepartureIndex,
): RouteTimetable {
  return {
    dir0: buildDirection(route, formattedDate, 0, startTimeSec, endTimeSec, routeIndex),
    dir1: buildDirection(route, formattedDate, 1, startTimeSec, endTimeSec, routeIndex),
  }
}

function buildDirection (
  route: Route,
  formattedDate: string,
  dir: number,
  startTimeSec: number,
  endTimeSec: number,
  routeIndex: RouteDepartureIndex,
): DirectionTimetable {
  const rep = pickRepresentativeStop(routeIndex, route.id, dir, formattedDate)
  const dateStopDeps = routeIndex.getRouteDate(route.id, dir, formattedDate)

  interface Agg {
    firstStopId: number
    firstDepartureTime: number
    lastStopId: number
    lastDepartureTime: number
    repStopDepartureTime?: number
    inWindow: boolean
  }
  const trips = new Map<number, Agg>()

  for (const [stopId, deps] of dateStopDeps.entries()) {
    for (const st of deps) {
      const inWindow = st.departureTime >= startTimeSec && st.departureTime <= endTimeSec
      const existing = trips.get(st.tripId)
      if (existing) {
        if (st.departureTime < existing.firstDepartureTime) {
          existing.firstDepartureTime = st.departureTime
          existing.firstStopId = stopId
        }
        if (st.departureTime > existing.lastDepartureTime) {
          existing.lastDepartureTime = st.departureTime
          existing.lastStopId = stopId
        }
        if (stopId === rep.stopId) {
          if (existing.repStopDepartureTime === undefined || st.departureTime < existing.repStopDepartureTime) {
            existing.repStopDepartureTime = st.departureTime
          }
        }
        if (inWindow) {
          existing.inWindow = true
        }
      } else {
        trips.set(st.tripId, {
          firstStopId: stopId,
          firstDepartureTime: st.departureTime,
          lastStopId: stopId,
          lastDepartureTime: st.departureTime,
          repStopDepartureTime: stopId === rep.stopId ? st.departureTime : undefined,
          inWindow,
        })
      }
    }
  }

  const rows: TimetableRow[] = []
  for (const [tripId, agg] of trips.entries()) {
    rows.push({
      tripId,
      directionId: dir,
      firstStopId: agg.firstStopId,
      firstDepartureTime: agg.firstDepartureTime,
      lastStopId: agg.lastStopId,
      lastDepartureTime: agg.lastDepartureTime,
      repStopDepartureTime: agg.repStopDepartureTime,
      inWindow: agg.inWindow,
    })
  }
  rows.sort((a, b) => a.firstDepartureTime - b.firstDepartureTime)

  return {
    directionId: dir,
    representativeStopId: rep.stopId,
    rows,
  }
}

/**
 * Pick the dominant direction for frequency calculations — the one with more
 * in-window departures at its representative stop across the date range.
 * Ties go to direction 0, mirroring scenario-filter.ts.
 */
export function pickDominantDirection (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string | undefined,
  selectedEndTime: string | undefined,
  routeIndex: RouteDepartureIndex,
): number {
  const deps = routeHeadways(route, selectedDateRange, selectedStartTime, selectedEndTime, routeIndex)
  const dir0Count = deps.dir0.reduce((sum, d) => sum + d.length, 0)
  const dir1Count = deps.dir1.reduce((sum, d) => sum + d.length, 0)
  return dir1Count > dir0Count ? 1 : 0
}

// Convenience wrapper for callers that have a Date object rather than a
// pre-formatted yyyy-MM-dd string.
export function formatDateForIndex (date: Date): string {
  return format(date, 'yyyy-MM-dd')
}
