import { describe, it, expect } from 'vitest'
import { routeHeadways, calculateHeadwayStats, hasServiceOnWeekday } from './route-headway'
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
  it('selects the representative stop (most departures) for each date', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const dateStr = '2024-01-15'
    const date = makeLocalDate(dateStr) // A Monday

    const sdCache = new StopDepartureCache()

    // Stop 2 visited by all 3 trips; stops 1/3/4 visited once each.
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

    // One date in range → one inner array.
    // Stop 2 is the rep stop (3 departures), so dir0[0] holds its 3 times.
    expect(result.dir0).toHaveLength(1)
    expect(result.dir0[0]).toEqual([hms('09:22'), hms('09:33'), hms('09:43')])
    // No dir1 activity in this fixture.
    expect(result.dir1).toHaveLength(1)
    expect(result.dir1[0]).toEqual([])
  })

  it('filters departures by time window', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '08:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '10:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1004', 0, [{ stopId: 1, departure: '11:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1005', 0, [{ stopId: 1, departure: '12:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)

    const resultNoFilter = routeHeadways(route, [date], undefined, undefined, routeIndex)
    expect(resultNoFilter.dir0[0]).toEqual([
      hms('08:00'), hms('09:00'), hms('10:00'), hms('11:00'), hms('12:00'),
    ])

    const resultStartOnly = routeHeadways(route, [date], '09:30:00', undefined, routeIndex)
    expect(resultStartOnly.dir0[0]).toEqual([hms('10:00'), hms('11:00'), hms('12:00')])

    const resultEndOnly = routeHeadways(route, [date], undefined, '10:30:00', routeIndex)
    expect(resultEndOnly.dir0[0]).toEqual([hms('08:00'), hms('09:00'), hms('10:00')])

    const resultEmpty = routeHeadways(route, [date], '13:00:00', '14:00:00', routeIndex)
    expect(resultEmpty.dir0[0]).toEqual([])

    const result = routeHeadways(route, [date], '09:00:00', '10:30:00', routeIndex)
    expect(result.dir0[0]).toEqual([hms('09:00'), hms('10:00')])
  })

  it('keeps each date in its own inner array, positionally aligned with selectedDateRange', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const monday = makeLocalDate('2024-01-15')
    const tuesday = makeLocalDate('2024-01-16')

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:30:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1004', 0, [{ stopId: 1, departure: '09:30:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1005', 0, [{ stopId: 1, departure: '10:00:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const result = routeHeadways(route, [monday, tuesday], undefined, undefined, routeIndex)

    expect(result.dir0).toHaveLength(2)
    expect(result.dir0[0]).toEqual([hms('09:00'), hms('09:30')]) // Monday
    expect(result.dir0[1]).toEqual([hms('09:00'), hms('09:30'), hms('10:00')]) // Tuesday
  })

  it('keeps empty inner arrays for service-less days to preserve positional mapping', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const dates = [
      makeLocalDate('2024-01-15'),
      makeLocalDate('2024-01-16'),
      makeLocalDate('2024-01-17'),
    ]

    const sdCache = new StopDepartureCache()
    // Only the middle date has service.
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:30:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const result = routeHeadways(route, dates, undefined, undefined, routeIndex)

    expect(result.dir0).toHaveLength(3)
    expect(result.dir0[0]).toEqual([])
    expect(result.dir0[1]).toEqual([hms('09:00'), hms('09:30')])
    expect(result.dir0[2]).toEqual([])
  })

  it('returns empty arrays when no routeIndex is provided', () => {
    const route = makeRoute(100)
    const date = makeLocalDate('2024-01-15')

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', undefined)

    expect(result.dir0).toEqual([])
    expect(result.dir1).toEqual([])
  })

  it('handles a route with no departures', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')

    const sdCache = new StopDepartureCache()
    const routeIndex = RouteDepartureIndex.fromCache(sdCache)

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(result.dir0).toEqual([[]])
    expect(result.dir1).toEqual([[]])
  })
})

describe('hasServiceOnWeekday', () => {
  const monday = makeLocalDate('2024-01-15') // Monday
  const tuesday = makeLocalDate('2024-01-16')
  const monday2 = makeLocalDate('2024-01-22') // the next Monday

  it('returns true when the matching weekday has at least one dir0 departure', () => {
    const deps = { dir0: [[hms('09:00')], []], dir1: [[], []] }
    expect(hasServiceOnWeekday(deps, [monday, tuesday], 'monday')).toBe(true)
    expect(hasServiceOnWeekday(deps, [monday, tuesday], 'tuesday')).toBe(false)
  })

  it('returns true when only dir1 has service', () => {
    const deps = { dir0: [[]], dir1: [[hms('09:00')]] }
    expect(hasServiceOnWeekday(deps, [monday], 'monday')).toBe(true)
  })

  it('returns true if any matching-weekday date has service, even if others do not', () => {
    // Two Mondays in range; only the second has service.
    const deps = { dir0: [[], [], []], dir1: [[], [], [hms('09:00')]] }
    expect(hasServiceOnWeekday(deps, [monday, tuesday, monday2], 'monday')).toBe(true)
  })

  it('returns false for a weekday that does not appear in the range', () => {
    const deps = { dir0: [[hms('09:00')]], dir1: [[]] }
    expect(hasServiceOnWeekday(deps, [monday], 'friday')).toBe(false)
  })

  it('returns false when the matching dates are all empty', () => {
    const deps = { dir0: [[], []], dir1: [[], []] }
    expect(hasServiceOnWeekday(deps, [monday, monday2], 'monday')).toBe(false)
  })
})

describe('calculateHeadwayStats', () => {
  it('calculates average, fastest, and slowest headways from a single day', () => {
    // 09:00, 09:15, 09:40, 10:05, 10:20, 10:55 → headways 15, 25, 25, 15, 35
    const stats = calculateHeadwayStats([[
      hms('09:00'),
      hms('09:15'),
      hms('09:40'),
      hms('10:05'),
      hms('10:20'),
      hms('10:55'),
    ]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(15 * 60)
    expect(stats!.slowest).toBe(35 * 60)
    expect(stats!.average).toBe(23 * 60)
  })

  it('returns undefined for empty input', () => {
    expect(calculateHeadwayStats([])).toBeUndefined()
    expect(calculateHeadwayStats([[]])).toBeUndefined()
  })

  it('returns undefined for a single departure', () => {
    expect(calculateHeadwayStats([[hms('09:00')]])).toBeUndefined()
  })

  it('calculates correct stats for two departures', () => {
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
    expect(stats!.average).toBe(24 * 60)
  })

  it('filters out headways under 2 minutes as noise', () => {
    const stats = calculateHeadwayStats([[
      hms('09:00'),
      hms('09:01'),
      hms('09:20'),
      hms('09:21'),
      hms('09:45'),
      hms('10:10'),
    ]])

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(19 * 60)
    expect(stats!.slowest).toBe(25 * 60)
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
    // Two days, each 06:00 and 22:00. The cross-day "gap" 22:00 Day1 → 06:00 Day2
    // must NOT appear in the stats.
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
    // Day 1 headways: 15, 30. Day 2 headway: 20. Avg = 65/3 min.
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
