import { describe, it, expect } from 'vitest'
import { routeHeadways, newRouteHeadwaySummary, calculateHeadwayStats, calculateRouteTripStats } from './route-headway'
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
  /**
   * Test scenario with synthetic data:
   */

  it('selects representative stop with most departures', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const dateStr = '2024-01-15'
    const date = makeLocalDate(dateStr) // A Monday

    // Create departure cache with synthetic data
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

    // Calculate headways
    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', routeIndex)

    // Stop 2 should be selected as the representative stop (it has 3 departures, others have fewer)
    expect(result.total.dir0.stop_id).toBe(2)

    // Direction 0 should have 3 departures at that stop
    expect(result.total.dir0.departures.length).toBe(3)

    // Monday should also have the departures (since Jan 15, 2024 is a Monday)
    expect(result.monday.dir0.departures.length).toBe(3)

    // Other days should be empty
    expect(result.tuesday.dir0.departures.length).toBe(0)
    expect(result.sunday.dir0.departures.length).toBe(0)
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

    // When startTime/endTime are undefined, no filtering occurs
    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const resultNoFilter = routeHeadways(route, [date], undefined, undefined, routeIndex)
    expect(resultNoFilter.total.dir0.departures.length).toBe(5)
    expect(resultNoFilter.total.dir0.departures).toContain(hms('08:00'))
    expect(resultNoFilter.total.dir0.departures).toContain(hms('09:00'))
    expect(resultNoFilter.total.dir0.departures).toContain(hms('10:00'))
    expect(resultNoFilter.total.dir0.departures).toContain(hms('11:00'))
    expect(resultNoFilter.total.dir0.departures).toContain(hms('12:00'))

    // When only startTime is set, filters "trips after X"
    const resultStartOnly = routeHeadways(route, [date], '09:30:00', undefined, routeIndex)
    expect(resultStartOnly.total.dir0.departures.length).toBe(3)
    expect(resultStartOnly.total.dir0.departures).toContain(hms('10:00'))
    expect(resultStartOnly.total.dir0.departures).toContain(hms('11:00'))
    expect(resultStartOnly.total.dir0.departures).toContain(hms('12:00'))

    // When only endTime is set, filters "trips before Y"
    const resultEndOnly = routeHeadways(route, [date], undefined, '10:30:00', routeIndex)
    expect(resultEndOnly.total.dir0.departures.length).toBe(3)
    expect(resultEndOnly.total.dir0.departures).toContain(hms('08:00'))
    expect(resultEndOnly.total.dir0.departures).toContain(hms('09:00'))
    expect(resultEndOnly.total.dir0.departures).toContain(hms('10:00'))

    // When time window doesn't match any departures, result is empty
    const resultEmpty = routeHeadways(route, [date], '13:00:00', '14:00:00', routeIndex)
    expect(resultEmpty.total.dir0.departures.length).toBe(0)

    // Filter to 09:00-10:30 window
    const result = routeHeadways(route, [date], '09:00:00', '10:30:00', routeIndex)

    // Should only include 09:00 and 10:00 departures
    expect(result.total.dir0.departures.length).toBe(2)
    expect(result.total.dir0.departures).toContain(hms('09:00'))
    expect(result.total.dir0.departures).toContain(hms('10:00'))
  })

  it('aggregates departures across multiple dates', () => {
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

    // Total should aggregate both days
    expect(result.total.dir0.departures.length).toBe(5)
    expect(result.total.dir0.departures).toContain(hms('09:00'))
    expect(result.total.dir0.departures).toContain(hms('09:30'))
    expect(result.total.dir0.departures).toContain(hms('10:00'))

    // Monday bucket should have 09:00 and 09:30
    expect(result.monday.dir0.departures.length).toBe(2)
    expect(result.monday.dir0.departures).toContain(hms('09:00'))
    expect(result.monday.dir0.departures).toContain(hms('09:30'))

    // Tuesday bucket should have 09:00, 09:30, 10:00
    expect(result.tuesday.dir0.departures.length).toBe(3)
    expect(result.tuesday.dir0.departures).toContain(hms('09:00'))
    expect(result.tuesday.dir0.departures).toContain(hms('09:30'))
    expect(result.tuesday.dir0.departures).toContain(hms('10:00'))
  })

  it('returns empty result when no cache provided', () => {
    const route = makeRoute(100)
    const date = makeLocalDate('2024-01-15')

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', undefined)

    expect(result.total.dir0.departures.length).toBe(0)
    expect(result.total.dir1.departures.length).toBe(0)
  })

  it('handles route with no departures', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')

    // Empty cache
    const sdCache = new StopDepartureCache()
    const routeIndex = RouteDepartureIndex.fromCache(sdCache)

    const result = routeHeadways(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(result.total.dir0.departures.length).toBe(0)
    expect(result.total.dir1.departures.length).toBe(0)
  })
})

describe('calculateHeadwayStats', () => {
  it('calculates average, fastest, and slowest headways', () => {
    // 6 departures with varying headways
    // 09:00, 09:15, 09:40, 10:05, 10:20, 10:55
    // Headways: 15, 25, 25, 15, 35 minutes
    const departures = [
      hms('09:00'),
      hms('09:15'),
      hms('09:40'),
      hms('10:05'),
      hms('10:20'),
      hms('10:55'),
    ]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(15 * 60) // 15 minutes
    expect(stats!.slowest).toBe(35 * 60) // 35 minutes
    expect(stats!.average).toBe(23 * 60) // (15+25+25+15+35)/5 = 23 minutes
  })

  it('returns undefined for empty departures', () => {
    const stats = calculateHeadwayStats([])
    expect(stats).toBeUndefined()
  })

  it('returns undefined for single departure', () => {
    const stats = calculateHeadwayStats([hms('09:00')])
    expect(stats).toBeUndefined()
  })

  it('calculates correct stats for two departures', () => {
    // Departures at 09:00 and 09:22 (single headway: 22min)
    const departures = [hms('09:00'), hms('09:22')]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(22 * 60)
    expect(stats!.slowest).toBe(22 * 60)
    expect(stats!.average).toBe(22 * 60)
  })

  it('handles uniform headways', () => {
    // Departures every 30 minutes: 09:00, 09:30, 10:00, 10:30, 11:00, 11:30
    const departures = [
      hms('09:00'),
      hms('09:30'),
      hms('10:00'),
      hms('10:30'),
      hms('11:00'),
      hms('11:30'),
    ]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(30 * 60)
    expect(stats!.slowest).toBe(30 * 60)
    expect(stats!.average).toBe(30 * 60)
  })

  it('sorts unsorted departures before calculating', () => {
    // 6 departures out of order with varying headways (20-30 min)
    // Sorted order: 09:00, 09:20, 09:50, 10:15, 10:40, 11:00
    // Headways: 20, 30, 25, 25, 20 minutes
    const departures = [
      hms('10:15'),
      hms('09:00'),
      hms('11:00'),
      hms('09:50'),
      hms('09:20'),
      hms('10:40'),
    ]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(20 * 60) // 20 minutes
    expect(stats!.slowest).toBe(30 * 60) // 30 minutes
    expect(stats!.average).toBe(24 * 60) // (20+30+25+25+20)/5 = 24 minutes
  })

  it('filters out headways under 2 minutes as noise', () => {
    // 6 departures with some bunched (under 2 min apart)
    // 09:00, 09:01, 09:20, 09:21, 09:45, 10:10
    // Raw headways: 1, 19, 1, 24, 25 minutes
    // After filtering (>= 2 min): 19, 24, 25 minutes
    const departures = [
      hms('09:00'),
      hms('09:01'), // bunched with 09:00 (1 min gap)
      hms('09:20'),
      hms('09:21'), // bunched with 09:20 (1 min gap)
      hms('09:45'),
      hms('10:10'),
    ]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeDefined()
    expect(stats!.fastest).toBe(19 * 60) // 19 minutes (09:01 to 09:20)
    expect(stats!.slowest).toBe(25 * 60) // 25 minutes (09:45 to 10:10)
    expect(stats!.average).toBeCloseTo((19 + 24 + 25) / 3 * 60) // ~22.67 minutes
  })

  it('returns undefined when all headways are under 2 minutes', () => {
    // All departures bunched together (under 2 min apart)
    const departures = [
      hms('09:00'),
      hms('09:01'),
      hms('09:01:30'),
      hms('09:02'),
    ]
    const stats = calculateHeadwayStats(departures)

    expect(stats).toBeUndefined()
  })
})

describe('calculateRouteTripStats', () => {
  it('computes averageTripsPerDay and averageTripsPerHour in all-day mode', () => {
    const routeId = 100
    const route = makeRoute(routeId)
    const date = makeLocalDate('2024-01-15')
    const dateStr = '2024-01-15'

    const sdCache = new StopDepartureCache()
    // 3 trips with two stop_times each
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
    // Day 1: earliest trip 06:30, latest trip 19:00.
    // Day 2: earliest trip 05:45 (overall earliest), latest trip 22:15 (overall latest).
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
    // Two dir=0 trips
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1001', 0, [{ stopId: 1, departure: '08:00:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1002', 0, [{ stopId: 1, departure: '09:00:00' }]))
    // Two dir=1 trips
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1003', 1, [{ stopId: 2, departure: '08:15:00' }]))
    addTripToCache(sdCache, dateStr, makeTrip(routeId, '1004', 1, [{ stopId: 2, departure: '09:15:00' }]))

    const routeIndex = RouteDepartureIndex.fromCache(sdCache)
    const stats = calculateRouteTripStats(route, [date], '00:00:00', '24:00:00', routeIndex)

    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(4)
  })

  it('does not double-count a trip whose stop_times are split across directions (defensive)', () => {
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
    // "not in window." If this ever changes (e.g. to include the full
    // service day), this test will flag it.
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
    // trip is excluded entirely.
    expect(stats).toBeDefined()
    expect(stats!.tripCount).toBe(1)
    // Included trip reports its full span, including the 25:30 stop_time.
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
