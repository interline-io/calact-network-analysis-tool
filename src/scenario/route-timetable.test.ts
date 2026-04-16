import { describe, it, expect } from 'vitest'
import { StopDepartureCache, RouteDepartureIndex } from '../tl/departure-cache'
import type { Route } from '../tl/route'
import type { StopTime } from '../tl/departure'
import { buildRouteTimetable } from './route-timetable'

interface TripStop {
  stopId: number
  departure: string
}

function makeTrip (
  routeId: number,
  tripId: string,
  direction: number,
  stops: TripStop[],
): Map<number, StopTime[]> {
  const result = new Map<number, StopTime[]>()
  for (const stop of stops) {
    const stopTime: StopTime = {
      departure_time: stop.departure,
      trip: {
        id: parseInt(tripId),
        direction_id: direction,
        trip_id: tripId,
        route: { id: routeId },
      },
    }
    const existing = result.get(stop.stopId) || []
    existing.push(stopTime)
    result.set(stop.stopId, existing)
  }
  return result
}

function addTripToCache (cache: StopDepartureCache, dateStr: string, trip: Map<number, StopTime[]>) {
  for (const [stopId, stopTimes] of trip) {
    cache.add(stopId, dateStr, stopTimes)
  }
}

function makeRoute (id: number): Route {
  return {
    id,
    route_id: `route-${id}`,
    route_short_name: `R${id}`,
    route_long_name: `Route ${id}`,
    route_type: 3,
    geometry: { type: 'MultiLineString', coordinates: [] },
    agency: { id: 1, agency_id: 'agency-1', agency_name: 'Test Agency' },
    feed_version: { sha1: 'sha1', feed: { onestop_id: 'feed' } },
    marked: true,
    route_name: `Route ${id}`,
    agency_name: 'Test Agency',
    route_mode: 'Bus',
  }
}

function hms (time: string): number {
  const [h, m, s] = time.split(':').map(Number)
  return h! * 3600 + m! * 60 + (s || 0)
}

const DATE = '2024-01-15'
const WINDOW_ALL_DAY = { start: 0, end: 86400 }

describe('buildRouteTimetable', () => {
  it('builds one row per trip in a single direction with first/last/rep populated', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    // Stop 2 is visited by 3 trips; stops 1/3 only by 2 each — stop 2 is the
    // unambiguous rep stop.
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '07:00:00' },
      { stopId: 2, departure: '07:15:00' },
      { stopId: 3, departure: '07:30:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '08:00:00' },
      { stopId: 2, departure: '08:15:00' },
      { stopId: 3, departure: '08:30:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1003', 0, [
      { stopId: 2, departure: '09:15:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.representativeStopId).toBe(2)
    expect(tt.dir0.rows).toHaveLength(3)
    expect(tt.dir1.rows).toHaveLength(0)
    expect(tt.dir1.representativeStopId).toBeUndefined()

    const r1 = tt.dir0.rows[0]!
    expect(r1.tripId).toBe(1001)
    expect(r1.directionId).toBe(0)
    expect(r1.firstStopId).toBe(1)
    expect(r1.firstDepartureTime).toBe(hms('07:00'))
    expect(r1.lastStopId).toBe(3)
    expect(r1.lastDepartureTime).toBe(hms('07:30'))
    expect(r1.repStopDepartureTime).toBe(hms('07:15'))
    expect(r1.inWindow).toBe(true)

    expect(tt.dir0.rows[1]!.tripId).toBe(1002)
    expect(tt.dir0.rows[1]!.repStopDepartureTime).toBe(hms('08:15'))
  })

  it('sorts rows by firstDepartureTime within each direction', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    addTripToCache(sdCache, DATE, makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '07:00:00' }]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '08:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.rows.map(r => r.tripId)).toEqual([1001, 1002, 1003])
  })

  it('leaves repStopDepartureTime undefined for trips that do not visit the rep stop', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    // Stop 2 is rep (3 departures). Trip 1003 goes stop 4 → stop 5, skipping rep.
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '07:00:00' },
      { stopId: 2, departure: '07:15:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '08:00:00' },
      { stopId: 2, departure: '08:15:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1004', 0, [
      { stopId: 2, departure: '09:15:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1003', 0, [
      { stopId: 4, departure: '10:00:00' },
      { stopId: 5, departure: '10:10:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.representativeStopId).toBe(2)
    const skipped = tt.dir0.rows.find(r => r.tripId === 1003)
    expect(skipped!.repStopDepartureTime).toBeUndefined()
    const visited = tt.dir0.rows.find(r => r.tripId === 1001)
    expect(visited!.repStopDepartureTime).toBe(hms('07:15'))
  })

  it('reports the earliest rep-stop departure when a trip visits it multiple times (loop route)', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    // Loop: trip visits stop 2 (rep) twice, at 07:15 and 07:45.
    // Also add another trip so stop 2 clearly wins the rep pick (3 departures vs 2 each for stops 1/3).
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '07:00:00' },
      { stopId: 2, departure: '07:15:00' },
      { stopId: 3, departure: '07:30:00' },
      { stopId: 2, departure: '07:45:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '08:00:00' },
      { stopId: 2, departure: '08:15:00' },
      { stopId: 3, departure: '08:30:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.representativeStopId).toBe(2)
    const loop = tt.dir0.rows.find(r => r.tripId === 1001)!
    expect(loop.repStopDepartureTime).toBe(hms('07:15'))
  })

  it('populates both directions independently with their own rep stops', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    // Dir 0: stop 10 gets 3 departures → rep.
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 10, departure: '08:00:00' },
      { stopId: 11, departure: '08:10:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1002', 0, [
      { stopId: 10, departure: '09:00:00' },
      { stopId: 11, departure: '09:10:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1003', 0, [
      { stopId: 10, departure: '10:00:00' },
    ]))

    // Dir 1: stop 21 gets 3 departures → rep.
    addTripToCache(sdCache, DATE, makeTrip(routeId, '2001', 1, [
      { stopId: 20, departure: '08:05:00' },
      { stopId: 21, departure: '08:15:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '2002', 1, [
      { stopId: 20, departure: '09:05:00' },
      { stopId: 21, departure: '09:15:00' },
    ]))
    addTripToCache(sdCache, DATE, makeTrip(routeId, '2003', 1, [
      { stopId: 21, departure: '10:15:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.representativeStopId).toBe(10)
    expect(tt.dir1.representativeStopId).toBe(21)
    expect(tt.dir0.rows).toHaveLength(3)
    expect(tt.dir1.rows).toHaveLength(3)
    expect(tt.dir1.rows[0]!.repStopDepartureTime).toBe(hms('08:15'))
  })

  it('marks inWindow=false when none of a trip\'s stop_times fall in the window', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '05:00:00' },
      { stopId: 2, departure: '05:30:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, hms('07:00:00'), hms('09:00:00'), routeIndex)

    expect(tt.dir0.rows).toHaveLength(1)
    expect(tt.dir0.rows[0]!.inWindow).toBe(false)
  })

  it('marks inWindow=true when ≥1 stop_time falls in the window, even if others do not', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()

    // Trip starts before window but has a stop_time inside it.
    addTripToCache(sdCache, DATE, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '06:30:00' },
      { stopId: 2, departure: '07:30:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, hms('07:00:00'), hms('09:00:00'), routeIndex)

    const row = tt.dir0.rows[0]!
    expect(row.inWindow).toBe(true)
    // Full span preserved — first stop still reports its pre-window time.
    expect(row.firstDepartureTime).toBe(hms('06:30'))
  })

  it('returns empty rows and undefined rep stop when the route has no service on this date', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const sdCache = new StopDepartureCache()
    // Service on a different date only.
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '08:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const tt = buildRouteTimetable(route, DATE, WINDOW_ALL_DAY.start, WINDOW_ALL_DAY.end, routeIndex)

    expect(tt.dir0.rows).toHaveLength(0)
    expect(tt.dir1.rows).toHaveLength(0)
    expect(tt.dir0.representativeStopId).toBeUndefined()
    expect(tt.dir1.representativeStopId).toBeUndefined()
  })
})

