import { describe, it, expect } from 'vitest'
import { routeHeadways, newRouteHeadwaySummary, calculateHeadwayStats } from './route-headway'
import { StopDepartureCache, RouteDepartureIndex } from '../tl/departure-cache'
import type { Route } from '../tl/route'
import type { StopTime } from '../tl/departure'

interface TripStop {
  stopId: number
  departure: string
}

/**
 * Helper to create StopTimes for a trip with multiple stops
 * Returns a map of stopId -> StopTime[] that can be added to the cache
 */
function makeTrip (
  routeId: number,
  tripId: string,
  direction: number,
  stops: TripStop[]
): Map<number, StopTime[]> {
  const result = new Map<number, StopTime[]>()
  for (const stop of stops) {
    const stopTime: StopTime = {
      departure_time: stop.departure,
      trip: {
        id: parseInt(tripId),
        direction_id: direction,
        trip_id: tripId,
        route: {
          id: routeId
        }
      }
    }
    const existing = result.get(stop.stopId) || []
    existing.push(stopTime)
    result.set(stop.stopId, existing)
  }
  return result
}

/**
 * Helper to add trip stop times to a cache for a given date
 */
function addTripToCache (cache: StopDepartureCache, dateStr: string, tripStops: Map<number, StopTime[]>): void {
  for (const [stopId, stopTimes] of tripStops) {
    cache.add(stopId, dateStr, stopTimes)
  }
}

/**
 * Helper to create a minimal Route object for testing
 */
function makeRoute (id: number): Route {
  return {
    id,
    route_id: `route-${id}`,
    route_short_name: `R${id}`,
    route_long_name: `Route ${id}`,
    route_type: 3, // bus
    geometry: { type: 'MultiLineString', coordinates: [] },
    agency: {
      id: 1,
      agency_id: 'agency-1',
      agency_name: 'Test Agency'
    },
    feed_version: {
      sha1: 'test-sha1',
      feed: {
        onestop_id: 'test-feed'
      }
    },
    marked: true,
    route_name: `Route ${id}`,
    agency_name: 'Test Agency',
    route_mode: 'Bus',
    headways: newRouteHeadwaySummary(),
  }
}

/**
 * Helper to create a local date (not UTC) for a given YYYY-MM-DD string
 * This ensures format(date, 'yyyy-MM-dd') returns the same string
 */
function makeLocalDate (dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

/**
 * Helper to parse HH:MM:SS time string to seconds since midnight
 */
function hms (time: string): number {
  const [h, m, s] = time.split(':').map(Number)
  return h! * 3600 + m! * 60 + (s || 0)
}

describe('routeHeadways', () => {
  it('selects representative stop with most departures', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const dateStr = '2024-01-15'
    const date = makeLocalDate(dateStr) // A Monday

    const sdCache = new StopDepartureCache()

    // 3 trips, with varying stop patterns
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '09:20:00' },
      { stopId: 2, departure: '09:22:00' },
      { stopId: 3, departure: '09:25:00' },
    ]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [
      { stopId: 2, departure: '09:33:00' },
      { stopId: 3, departure: '09:36:00' },
      { stopId: 4, departure: '09:39:00' },
    ]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 0, [
      { stopId: 2, departure: '09:43:00' },
      { stopId: 4, departure: '09:46:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', routeIndex)

    // Stop 2 should be selected as the representative stop (3 departures)
    expect(result.total.dir0.stop_id).toBe(2)

    // One date in range → one inner array with 3 departures
    expect(result.total.dir0.departures).toHaveLength(1)
    expect(result.total.dir0.departures[0]).toHaveLength(3)

    // Monday should also have the departures (since Jan 15, 2024 is a Monday)
    expect(result.monday.dir0.departures).toHaveLength(1)
    expect(result.monday.dir0.departures[0]).toHaveLength(3)

    // Other days should be empty (no inner arrays at all)
    expect(result.tuesday.dir0.departures).toHaveLength(0)
    expect(result.sunday.dir0.departures).toHaveLength(0)
  })

  it('filters departures by time window', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()

    // 5 trips at various times, each visiting stop 1
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '08:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '10:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1004', 0, [{ stopId: 1, departure: '11:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1005', 0, [{ stopId: 1, departure: '12:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)

    // When startTime/endTime are undefined, no filtering occurs
    const resultNoFilter = routeHeadways(route, [date], undefined, undefined, routeIndex)
    expect(resultNoFilter.total.dir0.departures.flat()).toHaveLength(5)
    expect(resultNoFilter.total.dir0.departures.flat()).toEqual([
      hms('08:00'), hms('09:00'), hms('10:00'), hms('11:00'), hms('12:00'),
    ])

    // When only startTime is set, filters "trips after X"
    const resultStartOnly = routeHeadways(route, [date], '09:30:00', undefined, routeIndex)
    expect(resultStartOnly.total.dir0.departures.flat()).toEqual([
      hms('10:00'), hms('11:00'), hms('12:00'),
    ])

    // When only endTime is set, filters "trips before Y"
    const resultEndOnly = routeHeadways(route, [date], undefined, '10:30:00', routeIndex)
    expect(resultEndOnly.total.dir0.departures.flat()).toEqual([
      hms('08:00'), hms('09:00'), hms('10:00'),
    ])

    // When time window doesn't match any departures, the inner array is empty
    const resultEmpty = routeHeadways(route, [date], '13:00:00', '14:00:00', routeIndex)
    expect(resultEmpty.total.dir0.departures.flat()).toHaveLength(0)

    // Filter to 09:00-10:30 window
    const result = routeHeadways(route, [date], '09:00:00', '10:30:00', routeIndex)
    expect(result.total.dir0.departures.flat()).toEqual([hms('09:00'), hms('10:00')])
  })

  it('keeps each date in its own inner array (per-day structure)', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const monday = makeLocalDate('2024-01-15')
    const tuesday = makeLocalDate('2024-01-16')

    const sdCache = new StopDepartureCache()

    // Monday: 2 trips
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:30:00' }]))

    // Tuesday: 3 trips
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1004', 0, [{ stopId: 1, departure: '09:30:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1005', 0, [{ stopId: 1, departure: '10:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const result = routeHeadways(route, [monday, tuesday], undefined, undefined, routeIndex)

    // Total has one inner array per date
    expect(result.total.dir0.departures).toHaveLength(2)
    expect(result.total.dir0.departures[0]).toEqual([hms('09:00'), hms('09:30')])
    expect(result.total.dir0.departures[1]).toEqual([hms('09:00'), hms('09:30'), hms('10:00')])

    // Monday bucket has only Monday's array
    expect(result.monday.dir0.departures).toHaveLength(1)
    expect(result.monday.dir0.departures[0]).toEqual([hms('09:00'), hms('09:30')])

    // Tuesday bucket has only Tuesday's array
    expect(result.tuesday.dir0.departures).toHaveLength(1)
    expect(result.tuesday.dir0.departures[0]).toEqual([hms('09:00'), hms('09:30'), hms('10:00')])
  })

  it('returns empty result when no cache provided', () => {
    const route = makeRoute(100)
    const date = makeLocalDate('2024-01-15')

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', undefined)

    expect(result.total.dir0.departures).toHaveLength(0)
    expect(result.total.dir1.departures).toHaveLength(0)
  })

  it('handles route with no departures', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')

    const sdCache = new StopDepartureCache()
    const routeIndex = RouteDepartureIndex.fromCache(sdCache)

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(result.total.dir0.departures.flat()).toHaveLength(0)
    expect(result.total.dir1.departures.flat()).toHaveLength(0)
  })
})

describe('calculateHeadwayStats', () => {
  it('calculates average, fastest, and slowest headways from a single day', () => {
    // 6 departures with varying headways
    // 09:00, 09:15, 09:40, 10:05, 10:20, 10:55
    // Headways: 15, 25, 25, 15, 35 minutes
    const departures = [[
      hms('09:00'),
      hms('09:15'),
      hms('09:40'),
      hms('10:05'),
      hms('10:20'),
      hms('10:55'),
    ]]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(15 * 60)
    expect(stats!.slowest).toBe(35 * 60)
    expect(stats!.average).toBe(23 * 60) // (15+25+25+15+35)/5 = 23
  })

  it('returns undefined for empty input', () => {
    expect(calculateHeadwayStats([])).toBeUndefined()
    expect(calculateHeadwayStats([[]])).toBeUndefined()
  })

  it('returns undefined for a single departure', () => {
    expect(calculateHeadwayStats([[hms('09:00')]])).toBeUndefined()
  })

  it('calculates correct stats for two departures', () => {
    // 09:00, 09:22 → single 22-minute headway
    const stats = calculateHeadwayStats([[hms('09:00'), hms('09:22')]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(22 * 60)
    expect(stats!.slowest).toBe(22 * 60)
    expect(stats!.average).toBe(22 * 60)
  })

  it('handles uniform headways', () => {
    const stats = calculateHeadwayStats([[
      hms('09:00'),
      hms('09:30'),
      hms('10:00'),
      hms('10:30'),
      hms('11:00'),
      hms('11:30'),
    ]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(30 * 60)
    expect(stats!.slowest).toBe(30 * 60)
    expect(stats!.average).toBe(30 * 60)
  })

  it('sorts unsorted departures within each day before calculating', () => {
    // 6 departures out of order with varying headways (20-30 min)
    // Sorted: 09:00, 09:20, 09:50, 10:15, 10:40, 11:00
    // Headways: 20, 30, 25, 25, 20 minutes
    const stats = calculateHeadwayStats([[
      hms('10:15'),
      hms('09:00'),
      hms('11:00'),
      hms('09:50'),
      hms('09:20'),
      hms('10:40'),
    ]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(20 * 60)
    expect(stats!.slowest).toBe(30 * 60)
    expect(stats!.average).toBe(24 * 60) // (20+30+25+25+20)/5 = 24
  })

  it('filters out headways under 2 minutes as noise', () => {
    // 09:00, 09:01, 09:20, 09:21, 09:45, 10:10
    // Raw headways: 1, 19, 1, 24, 25 minutes
    // After filtering (>= 2 min): 19, 24, 25 minutes
    const stats = calculateHeadwayStats([[
      hms('09:00'),
      hms('09:01'),
      hms('09:20'),
      hms('09:21'),
      hms('09:45'),
      hms('10:10'),
    ]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(19 * 60) // 09:01 to 09:20
    expect(stats!.slowest).toBe(25 * 60) // 09:45 to 10:10
    expect(stats!.average).toBeCloseTo((19 + 24 + 25) / 3 * 60)
  })

  it('returns undefined when all headways are under 2 minutes', () => {
    const stats = calculateHeadwayStats([[
      hms('09:00'),
      hms('09:01'),
      hms('09:01:30'),
      hms('09:02'),
    ]])

    expect(stats).toBeUndefined()
  })

  it('aggregates intervals across multiple days, never spanning service days', () => {
    // Day 1 (Monday): trips at 06:00 and 22:00 → one 16-hour intra-day gap
    // Day 2 (Tuesday): trips at 06:00 and 22:00 → one 16-hour intra-day gap
    // Cross-day "gap" between Mon 22:00 and Tue 06:00 must NOT appear.
    const stats = calculateHeadwayStats([
      [hms('06:00'), hms('22:00')],
      [hms('06:00'), hms('22:00')],
    ])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(16 * 3600)
    expect(stats!.slowest).toBe(16 * 3600)
    expect(stats!.average).toBe(16 * 3600)
  })

  it('combines per-day intervals into a single average', () => {
    // Day 1: 09:00, 09:15, 09:45 → headways 15, 30
    // Day 2: 10:00, 10:20 → headway 20
    // Aggregate: [15, 30, 20] → avg = 65/3 ≈ 21.67 min
    const stats = calculateHeadwayStats([
      [hms('09:00'), hms('09:15'), hms('09:45')],
      [hms('10:00'), hms('10:20')],
    ])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(15 * 60)
    expect(stats!.slowest).toBe(30 * 60)
    expect(stats!.average).toBeCloseTo(65 * 60 / 3)
  })

  it('skips days with fewer than 2 departures', () => {
    // Day 1 has 1 trip (no headway). Day 2 has 3 trips with consistent 20-min headways.
    const stats = calculateHeadwayStats([
      [hms('09:00')],
      [hms('10:00'), hms('10:20'), hms('10:40')],
    ])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(20 * 60)
    expect(stats!.slowest).toBe(20 * 60)
    expect(stats!.average).toBe(20 * 60)
  })
})
