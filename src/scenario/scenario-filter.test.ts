import { describe, it, expect } from 'vitest'
import { applyScenarioResultFilter } from './scenario-filter'
import { StopDepartureCache } from '../tl/departure-cache'
import { FlexDepartureCache } from '../tl/flex-departure-cache'
import { stopToStopCsv } from '../tl/stop'
import type { ScenarioData, ScenarioConfig, ScenarioFilter } from './scenario'
import type { FlexAreaFeature } from '../tl/flex'
import type { RouteGql } from '../tl/route'
import type { StopGql } from '../tl/stop'
import type { StopTime } from '../tl/departure'
import type { Weekday } from '../core'

// Minimal ScenarioConfig covering a Mon–Fri week (2024-01-15 Mon to 2024-01-19 Fri)
const baseConfig: ScenarioConfig = {
  reportName: 'test',
  startDate: new Date('2024-01-15T00:00:00'),
  endDate: new Date('2024-01-19T00:00:00'),
  geoDatasetName: 'test',
}

// Minimal FlexAreaFeature factory
function makeFlexFeature (id: number, agencyName = 'Test Agency'): FlexAreaFeature {
  return {
    type: 'Feature',
    id: `feed:loc-${id}`,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: {
      internal_id: id,
      location_id: `loc-${id}`,
      agencies: [{ agency_id: `agency-${id}`, agency_name: agencyName }],
      agency_ids: [`agency-${id}`],
      routes: [],
      route_ids: [],
      route_types: [],
      pickup_available: true,
      pickup_types: [2],
      pickup_booking_rule_ids: [],
      pickup_booking_rules: [],
      drop_off_available: false,
      drop_off_types: [],
      drop_off_booking_rule_ids: [],
      drop_off_booking_rules: [],
    },
  }
}

// Helper to build a FlexDepartureCache from (locationId, date) pairs
function makeFlexCache (entries: Array<[locationId: number, date: string]>): FlexDepartureCache {
  const cache = new FlexDepartureCache()
  for (const [id, date] of entries) {
    cache.add(id, date)
  }
  return cache
}

// Minimal ScenarioData
function makeData (flexAreas: FlexAreaFeature[], flexDepartureCache = new FlexDepartureCache()): ScenarioData {
  return {
    stops: [],
    routes: [],
    feedVersions: [],
    stopDepartureCache: new StopDepartureCache(),
    flexDepartureCache,
    flexAreas,
  }
}

describe('flexAreaMarked — agency filter', () => {
  it('marks all flex areas when no agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A'), makeFlexFeature(2, 'Agency B')])
    const filter: ScenarioFilter = {}
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas.every(a => a.properties.marked)).toBe(true)
  })

  it('marks only matching agency when agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A'), makeFlexFeature(2, 'Agency B')])
    const filter: ScenarioFilter = { selectedAgencies: ['Agency A'] }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    const [a, b] = result.flexAreas
    expect(a?.properties.marked).toBe(true)
    expect(b?.properties.marked).toBe(false)
  })

  it('marks nothing when empty agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A')])
    const filter: ScenarioFilter = { selectedAgencies: [] }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas.every(a => !a.properties.marked)).toBe(true)
  })
})

describe('flexAreaMarked — day-of-week filter', () => {
  // 2024-01-15 = Monday, 2024-01-16 = Tuesday, 2024-01-19 = Friday

  it('marks all when no weekday filter is active', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // only Monday
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = {}
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('marks area that has service on a selected weekday (Any mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // Monday
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('does not mark area that has no service on any selected weekday (Any mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-16']]) // Tuesday only
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'friday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('marks area that has service on all selected weekdays (All mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15'], [1, '2024-01-16']]) // Mon + Tue
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'tuesday'], selectedWeekdayMode: 'All' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('does not mark area missing service on one of the selected weekdays (All mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // Monday only
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'tuesday'], selectedWeekdayMode: 'All' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('does not mark area with no cache entries when weekday filter is active', () => {
    const data = makeData([makeFlexFeature(1)], new FlexDepartureCache())
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('recognises service on either of two Mondays in the date range', () => {
    // Extend config to two weeks
    const twoWeekConfig: ScenarioConfig = {
      ...baseConfig,
      endDate: new Date('2024-01-26T00:00:00'), // second week ends Friday
    }
    // Only the second Monday (2024-01-22) has service
    const cache = makeFlexCache([[1, '2024-01-22']])
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, twoWeekConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })
})

describe('applyScenarioResultFilter — route/stop derived fields (#239)', () => {
  const ROUTE_ID = 100
  const AGENCY_ID = 1
  const STOP_ID = 200

  function makeRouteGql (): RouteGql {
    return {
      id: ROUTE_ID,
      route_id: `route-${ROUTE_ID}`,
      route_short_name: `R${ROUTE_ID}`,
      route_long_name: `Route ${ROUTE_ID}`,
      route_type: 3,
      geometry: { type: 'MultiLineString', coordinates: [] },
      agency: { id: AGENCY_ID, agency_id: 'agency-1', agency_name: 'Test Agency' },
      feed_version: { sha1: 'sha1', feed: { onestop_id: 'feed' } },
      __typename: 'Route',
    }
  }

  function makeStopGql (): StopGql {
    return {
      id: STOP_ID,
      geometry: { type: 'Point', coordinates: [-122.68, 45.52] },
      location_type: 0,
      stop_id: `stop-${STOP_ID}`,
      stop_name: `Stop ${STOP_ID}`,
      census_geographies: [] as unknown as StopGql['census_geographies'],
      feed_version: { sha1: 'sha1', feed: { onestop_id: 'feed' } },
      route_stops: [{
        route: {
          id: ROUTE_ID,
          route_id: `route-${ROUTE_ID}`,
          route_type: 3,
          route_short_name: `R${ROUTE_ID}`,
          route_long_name: `Route ${ROUTE_ID}`,
          agency: { id: AGENCY_ID, agency_id: 'agency-1', agency_name: 'Test Agency' },
        },
      }],
      __typename: 'Stop',
    }
  }

  function addTrips (cache: StopDepartureCache, date: string, times: string[], startingTripId = 1000) {
    let tripId = startingTripId
    for (const t of times) {
      const st: StopTime = {
        departure_time: t,
        trip: {
          id: tripId++,
          direction_id: 0,
          trip_id: `trip-${tripId}`,
          route: { id: ROUTE_ID },
        },
      }
      cache.add(STOP_ID, date, [st])
    }
  }

  function buildData (): ScenarioData {
    const cache = new StopDepartureCache()
    // Trips only on Monday 2024-01-15 (calendar range is Mon–Fri = 5 days)
    addTrips(cache, '2024-01-15', ['07:00:00', '08:00:00', '09:00:00'])
    return {
      stops: [makeStopGql()],
      routes: [makeRouteGql()],
      feedVersions: [],
      stopDepartureCache: cache,
      flexDepartureCache: new FlexDepartureCache(),
      flexAreas: [],
    }
  }

  it('propagates averageTripsPerDay on the route using calendar-day denominator', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, {})
    const route = result.routes[0]!
    // 3 trips / 5 calendar days
    expect(route.average_trips_per_day).toBeCloseTo(3 / 5, 5)
    // All-day mode: 24-hour window, so per-hour divides by 24 as well
    expect(route.average_trips_per_hour).toBeCloseTo(3 / (24 * 5), 5)
  })

  it('propagates earliest/latest trip start/end on the route', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, {})
    const route = result.routes[0]!
    const hms = (hh: number, mm: number) => hh * 3600 + mm * 60
    expect(route.earliest_trip_start).toBe(hms(7, 0))
    expect(route.latest_trip_start).toBe(hms(9, 0))
    expect(route.earliest_trip_end).toBe(hms(7, 0))
    expect(route.latest_trip_end).toBe(hms(9, 0))
  })

  it('computes averageTripsPerHour against a narrow window using calendar days', () => {
    const filter: ScenarioFilter = {
      startTime: new Date('2020-01-01T07:00:00'),
      endTime: new Date('2020-01-01T09:00:00'),
    }
    const result = applyScenarioResultFilter(buildData(), baseConfig, filter)
    const route = result.routes[0]!
    // 3 trips fall in the 07:00-09:00 window (inclusive of 09:00:00).
    // Denominator = 2 hours × 5 calendar days.
    expect(route.average_trips_per_hour).toBeCloseTo(3 / (2 * 5), 5)
  })

  it('populates stop visit_count_total through stopToStopCsv', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, {})
    const stop = result.stops[0]!
    expect(stop.visits?.total.visit_count).toBe(3)
    // monday bucket should also see the 3 visits
    expect(stop.visits?.monday.visit_count).toBe(3)
    // Tuesday had no service
    expect(stop.visits?.tuesday.visit_count).toBe(0)
    const csv = stopToStopCsv(stop)
    expect(csv.visit_count_total).toBe(3)
    expect(csv.visit_count_monday_total).toBe(3)
    expect(csv.visit_count_tuesday_total).toBe(0)
  })

  it('clears route derived fields when no trips are in the filter window', () => {
    // Narrow the window to exclude all trips.
    const filter: ScenarioFilter = {
      startTime: new Date('2020-01-01T12:00:00'),
      endTime: new Date('2020-01-01T13:00:00'),
    }
    const result = applyScenarioResultFilter(buildData(), baseConfig, filter)
    const route = result.routes[0]!
    expect(route.average_trips_per_day).toBeUndefined()
    expect(route.average_trips_per_hour).toBeUndefined()
    expect(route.earliest_trip_start).toBeUndefined()
    expect(route.latest_trip_end).toBeUndefined()
  })
})

describe('applyScenarioResultFilter — weekday-scoped frequency (#222)', () => {
  // Full week: 2024-01-15 Mon … 2024-01-21 Sun (so the range mixes weekday and
  // weekend service days).
  const weekConfig: ScenarioConfig = {
    ...baseConfig,
    endDate: new Date('2024-01-21T00:00:00'),
  }
  const ROUTE_ID = 300
  const STOP_ID = 400
  const WEEKDAY_DATES = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19']
  const WEEKEND_DATES = ['2024-01-20', '2024-01-21']
  // 30-min headways on weekdays, 60-min headways on weekends.
  const WEEKDAY_TIMES = ['07:00:00', '07:30:00', '08:00:00', '08:30:00', '09:00:00']
  const WEEKEND_TIMES = ['07:00:00', '08:00:00', '09:00:00']
  const WEEKDAYS: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
  const WEEKEND: Weekday[] = ['saturday', 'sunday']

  function makeRouteGql (): RouteGql {
    return {
      id: ROUTE_ID,
      route_id: `route-${ROUTE_ID}`,
      route_short_name: `R${ROUTE_ID}`,
      route_long_name: `Route ${ROUTE_ID}`,
      route_type: 3,
      geometry: { type: 'MultiLineString', coordinates: [] },
      agency: { id: 1, agency_id: 'agency-1', agency_name: 'Test Agency' },
      feed_version: { sha1: 'sha1', feed: { onestop_id: 'feed' } },
      __typename: 'Route',
    }
  }

  function makeStopGql (): StopGql {
    return {
      id: STOP_ID,
      geometry: { type: 'Point', coordinates: [-122.68, 45.52] },
      location_type: 0,
      stop_id: `stop-${STOP_ID}`,
      stop_name: `Stop ${STOP_ID}`,
      census_geographies: [] as unknown as StopGql['census_geographies'],
      feed_version: { sha1: 'sha1', feed: { onestop_id: 'feed' } },
      route_stops: [{
        route: {
          id: ROUTE_ID,
          route_id: `route-${ROUTE_ID}`,
          route_type: 3,
          route_short_name: `R${ROUTE_ID}`,
          route_long_name: `Route ${ROUTE_ID}`,
          agency: { id: 1, agency_id: 'agency-1', agency_name: 'Test Agency' },
        },
      }],
      __typename: 'Stop',
    }
  }

  function buildData (): ScenarioData {
    const cache = new StopDepartureCache()
    let tripId = 5000
    const addTrips = (date: string, times: string[]) => {
      for (const t of times) {
        const st: StopTime = {
          departure_time: t,
          trip: { id: tripId++, direction_id: 0, trip_id: `trip-${tripId}`, route: { id: ROUTE_ID } },
        }
        cache.add(STOP_ID, date, [st])
      }
    }
    for (const d of WEEKDAY_DATES) { addTrips(d, WEEKDAY_TIMES) }
    for (const d of WEEKEND_DATES) { addTrips(d, WEEKEND_TIMES) }
    return {
      stops: [makeStopGql()],
      routes: [makeRouteGql()],
      feedVersions: [],
      stopDepartureCache: cache,
      flexDepartureCache: new FlexDepartureCache(),
      flexAreas: [],
    }
  }

  it('reports weekday frequency (30 min) when weekdays are selected', () => {
    const result = applyScenarioResultFilter(buildData(), weekConfig, { selectedWeekdays: WEEKDAYS, selectedWeekdayMode: 'Any' })
    const route = result.routes[0]!
    expect(route.average_frequency).toBe(30 * 60)
    expect(route.fastest_frequency).toBe(30 * 60)
    expect(route.slowest_frequency).toBe(30 * 60)
  })

  it('reports weekend frequency (60 min) when weekend days are selected', () => {
    const result = applyScenarioResultFilter(buildData(), weekConfig, { selectedWeekdays: WEEKEND, selectedWeekdayMode: 'Any' })
    const route = result.routes[0]!
    expect(route.average_frequency).toBe(60 * 60)
    expect(route.fastest_frequency).toBe(60 * 60)
    expect(route.slowest_frequency).toBe(60 * 60)
  })

  it('weekday and weekend selections produce different frequency (issue #222)', () => {
    const weekday = applyScenarioResultFilter(buildData(), weekConfig, { selectedWeekdays: WEEKDAYS, selectedWeekdayMode: 'Any' }).routes[0]!
    const weekend = applyScenarioResultFilter(buildData(), weekConfig, { selectedWeekdays: WEEKEND, selectedWeekdayMode: 'Any' }).routes[0]!
    expect(weekday.average_frequency).not.toBe(weekend.average_frequency)
  })

  it('pools all service days when no weekday subset is selected (unchanged all-days behavior)', () => {
    const result = applyScenarioResultFilter(buildData(), weekConfig, {})
    const route = result.routes[0]!
    // Fastest gap comes from weekdays (30 min), slowest from weekends (60 min).
    expect(route.fastest_frequency).toBe(30 * 60)
    expect(route.slowest_frequency).toBe(60 * 60)
  })

  it('scopes the average-trips denominator to the selected weekdays', () => {
    // 5 trips/day × 5 weekdays = 25 trips over 5 selected days.
    const result = applyScenarioResultFilter(buildData(), weekConfig, { selectedWeekdays: WEEKDAYS, selectedWeekdayMode: 'Any' })
    const route = result.routes[0]!
    expect(route.average_trips_per_day).toBeCloseTo(25 / 5, 5)
  })
})
