import { describe, it, expect } from 'vitest'
import {
  routeHeadways,
  calculateHeadwayStats,
  hasServiceOnWeekday,
  calculateRouteTripStats,
  computeHeadwaysPerDay,
  pickDominantDirection,
  MIN_HEADWAY_SECONDS,
  type RouteDepartures,
} from './route-headway'
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

  it('returns one empty inner array per date when no routeIndex is provided (preserves positional contract)', () => {
    const route = makeRoute(100)
    const dates = [
      makeLocalDate('2024-01-15'),
      makeLocalDate('2024-01-16'),
      makeLocalDate('2024-01-17'),
    ]

    const result = routeHeadways(route, dates, '00:00:00', '24:00:00', undefined)

    expect(result.dir0).toEqual([[], [], []])
    expect(result.dir1).toEqual([[], [], []])
  })

  it('returns empty arrays for an empty date range regardless of routeIndex presence', () => {
    const route = makeRoute(100)
    const resultNoIndex = routeHeadways(route, [], undefined, undefined, undefined)
    expect(resultNoIndex.dir0).toEqual([])
    expect(resultNoIndex.dir1).toEqual([])
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

describe('calculateRouteTripStats', () => {
  it('computes averageTripsPerDay and averageTripsPerHour in all-day mode', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '08:00:00' },
      { stopId: 2, departure: '08:15:00' },
    ]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '09:00:00' },
      { stopId: 2, departure: '09:15:00' },
    ]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 0, [
      { stopId: 1, departure: '10:00:00' },
      { stopId: 2, departure: '10:15:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(3)
    expect(stats!.dateCount).toBe(1)
    expect(stats!.hoursInWindow).toBe(24)
    expect(stats!.averageTripsPerDay).toBe(3)
    expect(stats!.averageTripsPerHour).toBeCloseTo(3 / 24, 5)
  })

  it('computes averageTripsPerHour correctly for a narrow window', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '07:30:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '08:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 0, [{ stopId: 1, departure: '08:30:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1004', 0, [{ stopId: 1, departure: '09:15:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '07:00:00', '09:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(3) // only trips 1001/1002/1003 have in-window stop_times
    expect(stats!.hoursInWindow).toBe(2)
    expect(stats!.averageTripsPerHour).toBeCloseTo(3 / 2, 5)
  })

  it('reports full trip span even when a trip starts before the window', () => {
    // Regression test for the trip-span bug fixed in issue #239:
    // a trip that starts at 07:45 but has stop_times through 09:30 should
    // report its actual start (07:45) when included in a 09:00-10:00 window.
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '07:45:00' }, // outside window
      { stopId: 2, departure: '08:30:00' }, // outside window
      { stopId: 3, departure: '09:10:00' }, // inside window
      { stopId: 4, departure: '09:30:00' }, // inside window
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '09:00:00', '10:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(1)
    expect(stats!.earliestTripStart).toBe(hms('07:45')) // the trip's actual start
    expect(stats!.latestTripEnd).toBe(hms('09:30')) // the trip's actual end
  })

  it('excludes trips with no stop_times in the window', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    // Trip entirely outside the window
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '05:00:00' },
      { stopId: 2, departure: '05:30:00' },
    ]))
    // Trip inside the window
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '09:00:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '08:00:00', '10:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(1)
    expect(stats!.dateCount).toBe(1)
  })

  it('divides trip averages by calendar days in range, not days with service', () => {
    // 5 calendar days, but the route only runs on 2 of them (3 trips each).
    // averageTripsPerDay must be 6/5, not 6/2.
    const routeId = 100
    const route = makeRoute(routeId)
    const dates = [
      makeLocalDate('2024-01-15'),
      makeLocalDate('2024-01-16'),
      makeLocalDate('2024-01-17'),
      makeLocalDate('2024-01-18'),
      makeLocalDate('2024-01-19'),
    ]

    const sdCache = new StopDepartureCache()
    let tripCounter = 1000
    for (const dateStr of ['2024-01-15', '2024-01-17']) {
      addTripToCache(sdCache, dateStr, makeTrip(routeId, String(tripCounter++), 0, [{ stopId: 1, departure: '08:00:00' }]))
      addTripToCache(sdCache, dateStr, makeTrip(routeId, String(tripCounter++), 0, [{ stopId: 1, departure: '09:00:00' }]))
      addTripToCache(sdCache, dateStr, makeTrip(routeId, String(tripCounter++), 0, [{ stopId: 1, departure: '10:00:00' }]))
    }

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, dates, '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(6)
    expect(stats!.dateCount).toBe(5)
    expect(stats!.averageTripsPerDay).toBeCloseTo(6 / 5, 5)
    expect(stats!.averageTripsPerHour).toBeCloseTo(6 / (24 * 5), 5)
  })

  it('aggregates earliest/latest across multiple dates', () => {
    // Day 1: earliest 06:30, latest 19:00.
    // Day 2: earliest 05:45 (overall), latest 22:15 (overall).
    const routeId = 100
    const route = makeRoute(routeId)
    const day1 = makeLocalDate('2024-01-15')
    const day2 = makeLocalDate('2024-01-16')

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '06:30:00' },
      { stopId: 2, departure: '06:50:00' },
    ]))
    addTripToCache(sdCache, '2024-01-15', makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '19:00:00' },
      { stopId: 2, departure: '19:20:00' },
    ]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1003', 0, [
      { stopId: 1, departure: '05:45:00' },
      { stopId: 2, departure: '06:05:00' },
    ]))
    addTripToCache(sdCache, '2024-01-16', makeTrip(routeId, '1004', 0, [
      { stopId: 1, departure: '21:50:00' },
      { stopId: 2, departure: '22:15:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [day1, day2], '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(4)
    expect(stats!.dateCount).toBe(2)
    expect(stats!.earliestTripStart).toBe(hms('05:45'))
    expect(stats!.latestTripStart).toBe(hms('21:50'))
    expect(stats!.earliestTripEnd).toBe(hms('06:05'))
    expect(stats!.latestTripEnd).toBe(hms('22:15'))
  })

  it('counts trips from both directions', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '08:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 1, [{ stopId: 2, departure: '08:15:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1004', 1, [{ stopId: 2, departure: '09:15:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(4)
  })

  it('does not double-count a trip whose stop_times are split across directions', () => {
    // A single tripId should only be counted once even if its stop_times
    // somehow land under both direction buckets in the index.
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '5001', 0, [
      { stopId: 1, departure: '08:00:00' },
    ]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '5001', 1, [
      { stopId: 2, departure: '08:30:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(1)
    expect(stats!.earliestTripStart).toBe(hms('08:00'))
    expect(stats!.latestTripEnd).toBe(hms('08:30'))
  })

  it('drops after-midnight GTFS times (>24:00) under the default 24:00 end window', () => {
    // Documents pre-existing behavior: a 25:30 departure falls outside the
    // default all-day window (endTime = 24:00 = 86400s) and is treated as
    // "not in window."
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '23:45:00' },
      { stopId: 2, departure: '25:30:00' }, // after-midnight
    ]))
    // A second trip entirely after midnight
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [
      { stopId: 1, departure: '25:00:00' },
      { stopId: 2, departure: '25:45:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '00:00:00', '24:00:00', routeIndex)

    // Only the first trip has an in-window stop_time (23:45); the after-midnight
    // trip is excluded entirely. The included trip reports its full span.
    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(1)
    expect(stats!.latestTripEnd).toBe(hms('25:30'))
  })

  it('returns undefined when no trips are included on any date', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [
      { stopId: 1, departure: '05:00:00' },
    ]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '08:00:00', '10:00:00', routeIndex)

    expect(stats).toBeUndefined()
  })
})

describe('computeHeadwaysPerDay', () => {
  it('returns one Headway per consecutive within-day pair', () => {
    const day = [hms('08:00'), hms('08:30'), hms('09:00')]
    const headways = computeHeadwaysPerDay([day], n => n)
    expect(headways).toHaveLength(2)
    expect(headways[0]!.gap).toBe(30 * 60)
    expect(headways[1]!.gap).toBe(30 * 60)
    expect(headways.every(h => !h.isNoise)).toBe(true)
  })

  it('flags gaps under MIN_HEADWAY_SECONDS as noise without dropping them', () => {
    const day = [hms('08:00'), hms('08:01'), hms('08:30')]
    const headways = computeHeadwaysPerDay([day], n => n)
    expect(headways).toHaveLength(2)
    expect(headways[0]!.gap).toBe(60)
    expect(headways[0]!.isNoise).toBe(true) // 60s < MIN_HEADWAY_SECONDS
    expect(headways[1]!.gap).toBe(29 * 60)
    expect(headways[1]!.isNoise).toBe(false)
    // Threshold boundary check — MIN_HEADWAY_SECONDS itself is NOT noise.
    expect(MIN_HEADWAY_SECONDS).toBe(120)
    const boundary = computeHeadwaysPerDay([[0, MIN_HEADWAY_SECONDS]], n => n)
    expect(boundary[0]!.isNoise).toBe(false)
  })

  it('never produces cross-day pairs', () => {
    const day1 = [hms('22:00'), hms('22:30')]
    const day2 = [hms('06:00'), hms('06:30')]
    const headways = computeHeadwaysPerDay([day1, day2], n => n)
    // Two within-day pairs — none spanning midnight.
    expect(headways).toHaveLength(2)
    expect(headways[0]!.gap).toBe(30 * 60)
    expect(headways[1]!.gap).toBe(30 * 60)
  })

  it('returns nothing when a day has fewer than 2 entries', () => {
    expect(computeHeadwaysPerDay([[hms('08:00')]], n => n)).toHaveLength(0)
    expect(computeHeadwaysPerDay([[]], n => n)).toHaveLength(0)
  })

  it('works with rich item types via the getTime selector', () => {
    interface Dep { tripId: number, time: number }
    const day: Dep[] = [
      { tripId: 1, time: hms('08:00') },
      { tripId: 2, time: hms('08:30') },
    ]
    const headways = computeHeadwaysPerDay<Dep>([day], d => d.time)
    expect(headways).toHaveLength(1)
    expect(headways[0]!.from.tripId).toBe(1)
    expect(headways[0]!.to.tripId).toBe(2)
    expect(headways[0]!.gap).toBe(30 * 60)
  })
})

describe('pickDominantDirection', () => {
  // Build a minimal RouteDepartures fixture directly (no full routeHeadways flow
  // needed — the helper operates on this shape).
  const make = (dir0: number[][], dir1: number[][]): RouteDepartures => ({ dir0, dir1 })

  it('returns 0 when direction 0 has strictly more departures', () => {
    expect(pickDominantDirection(make([[1, 2, 3]], [[1]]))).toBe(0)
  })

  it('returns 1 when direction 1 has strictly more departures', () => {
    expect(pickDominantDirection(make([[1]], [[1, 2, 3]]))).toBe(1)
  })

  it('returns 0 on a tie (matches scenario-filter inline behavior)', () => {
    expect(pickDominantDirection(make([[1, 2]], [[3, 4]]))).toBe(0)
  })

  it('returns 0 when both directions are empty', () => {
    expect(pickDominantDirection(make([], []))).toBe(0)
    expect(pickDominantDirection(make([[]], [[]]))).toBe(0)
  })

  it('aggregates counts across all dates, not per-date', () => {
    // dir 0: 1 + 1 = 2; dir 1: 3 + 0 = 3 → dir 1 wins.
    expect(pickDominantDirection(make([[1], [1]], [[1, 2, 3], []]))).toBe(1)
  })
})
