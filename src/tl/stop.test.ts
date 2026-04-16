import { describe, it, expect } from 'vitest'
import { stopToStopCsv, stopGeoAggregateCsv } from './stop'
import type { Stop, StopVisitSummary, StopVisitCounts } from './stop'

function counts (visit_count: number, date_count = 1): StopVisitCounts {
  return { visit_count, date_count, visit_average: date_count ? visit_count / date_count : 0, all_date_service: visit_count > 0 }
}

function makeVisitSummary (overrides: Partial<Record<keyof StopVisitSummary, StopVisitCounts>>): StopVisitSummary {
  return {
    total: overrides.total ?? counts(0, 0),
    monday: overrides.monday ?? counts(0, 0),
    tuesday: overrides.tuesday ?? counts(0, 0),
    wednesday: overrides.wednesday ?? counts(0, 0),
    thursday: overrides.thursday ?? counts(0, 0),
    friday: overrides.friday ?? counts(0, 0),
    saturday: overrides.saturday ?? counts(0, 0),
    sunday: overrides.sunday ?? counts(0, 0),
  }
}

interface RouteStopArgs {
  routeInternalId: number
  routeId?: string
  routeType?: number
  agencyId: number
  agencyName?: string
}

function makeRouteStop (a: RouteStopArgs) {
  return {
    route: {
      id: a.routeInternalId,
      route_id: a.routeId ?? `route-${a.routeInternalId}`,
      route_type: a.routeType ?? 3,
      route_short_name: `R${a.routeInternalId}`,
      route_long_name: `Route ${a.routeInternalId}`,
      agency: {
        id: a.agencyId,
        agency_id: `agency-${a.agencyId}`,
        agency_name: a.agencyName ?? `Agency ${a.agencyId}`,
      },
    },
  }
}

function makeStop (partial: Partial<Stop> & { id: number }): Stop {
  return {
    id: partial.id,
    geometry: partial.geometry ?? { type: 'Point', coordinates: [-122.68, 45.52] },
    location_type: partial.location_type ?? 0,
    stop_id: partial.stop_id ?? `stop-${partial.id}`,
    stop_name: partial.stop_name ?? `Stop ${partial.id}`,
    route_stops: partial.route_stops ?? [],
    census_geographies: partial.census_geographies ?? ([] as unknown as Stop['census_geographies']),
    feed_version: partial.feed_version ?? { sha1: 'sha1', feed: { onestop_id: 'feed' } },
    marked: partial.marked ?? true,
    visits: partial.visits,
    __typename: 'Stop',
  }
}

describe('stopToStopCsv', () => {
  it('sets visit_count_total and per-weekday totals from stop.visits', () => {
    const stop = makeStop({
      id: 1,
      route_stops: [
        makeRouteStop({ routeInternalId: 10, agencyId: 1 }),
        makeRouteStop({ routeInternalId: 11, agencyId: 1 }),
      ],
      visits: makeVisitSummary({
        total: counts(42, 5),
        monday: counts(10, 1),
        tuesday: counts(8, 1),
        wednesday: counts(9, 1),
        thursday: counts(8, 1),
        friday: counts(7, 1),
      }),
    })

    const csv = stopToStopCsv(stop)
    expect(csv.visit_count_total).toBe(42)
    expect(csv.visit_count_monday_total).toBe(10)
    expect(csv.visit_count_tuesday_total).toBe(8)
    expect(csv.visit_count_wednesday_total).toBe(9)
    expect(csv.visit_count_thursday_total).toBe(8)
    expect(csv.visit_count_friday_total).toBe(7)
    expect(csv.visit_count_saturday_total).toBe(0)
    expect(csv.visit_count_sunday_total).toBe(0)
  })

  it('emits visit_count_total = 0 for a stop with zero in-window visits', () => {
    const stop = makeStop({
      id: 2,
      route_stops: [makeRouteStop({ routeInternalId: 10, agencyId: 1 })],
      visits: makeVisitSummary({ total: counts(0, 5) }),
    })
    expect(stopToStopCsv(stop).visit_count_total).toBe(0)
  })

  it('leaves visit_count_total undefined when stop.visits is missing', () => {
    const stop = makeStop({ id: 3 })
    expect(stopToStopCsv(stop).visit_count_total).toBeUndefined()
  })

  it('counts agencies uniquely when multiple routes share an agency', () => {
    const stop = makeStop({
      id: 4,
      route_stops: [
        makeRouteStop({ routeInternalId: 10, agencyId: 1 }),
        makeRouteStop({ routeInternalId: 11, agencyId: 1 }),
        makeRouteStop({ routeInternalId: 12, agencyId: 2 }),
      ],
    })
    const csv = stopToStopCsv(stop)
    // Pre-existing behavior: routes_count is the raw route_stops length
    // (not filter-aware, not de-duped). Tracked as #239 follow-up.
    expect(csv.routes_count).toBe(3)
    expect(csv.agencies_count).toBe(2)
  })

  it('joins unique route modes in routes_modes', () => {
    const stop = makeStop({
      id: 5,
      route_stops: [
        makeRouteStop({ routeInternalId: 10, agencyId: 1, routeType: 3 }), // Bus
        makeRouteStop({ routeInternalId: 11, agencyId: 1, routeType: 3 }), // Bus dup
        makeRouteStop({ routeInternalId: 12, agencyId: 2, routeType: 0 }), // Tram
      ],
    })
    const modes = stopToStopCsv(stop).routes_modes.split(',').map(s => s.trim()).sort()
    expect(modes).toEqual(['Bus', 'Light rail'])
  })
})

describe('stopGeoAggregateCsv', () => {
  const tract = (geoid: string, name = `Tract ${geoid}`) => ({
    id: Number(geoid),
    geoid,
    layer_name: 'tract',
    name,
  })

  it('sums visit_count across stops within the same aggregation geography', () => {
    const stops: Stop[] = [
      makeStop({
        id: 1,
        route_stops: [makeRouteStop({ routeInternalId: 10, agencyId: 1 })],
        census_geographies: [tract('100')] as unknown as Stop['census_geographies'],
        visits: makeVisitSummary({ total: counts(30, 5) }),
      }),
      makeStop({
        id: 2,
        route_stops: [makeRouteStop({ routeInternalId: 11, agencyId: 2 })],
        census_geographies: [tract('100')] as unknown as Stop['census_geographies'],
        visits: makeVisitSummary({ total: counts(12, 5) }),
      }),
      makeStop({
        id: 3,
        route_stops: [makeRouteStop({ routeInternalId: 12, agencyId: 1 })],
        census_geographies: [tract('200')] as unknown as Stop['census_geographies'],
        visits: makeVisitSummary({ total: counts(7, 5) }),
      }),
    ]

    const result = stopGeoAggregateCsv(stops, 'tract')
    const byGeoid = new Map(result.map(r => [r.geoid, r]))

    expect(byGeoid.get('100')?.visit_count_total).toBe(42)
    expect(byGeoid.get('100')?.stops_count).toBe(2)
    expect(byGeoid.get('100')?.routes_count).toBe(2)
    expect(byGeoid.get('100')?.agencies_count).toBe(2)

    expect(byGeoid.get('200')?.visit_count_total).toBe(7)
    expect(byGeoid.get('200')?.stops_count).toBe(1)
    expect(byGeoid.get('200')?.routes_count).toBe(1)
    expect(byGeoid.get('200')?.agencies_count).toBe(1)
  })

  it('filters census_geographies by aggregationKey (layer_name)', () => {
    const stop = makeStop({
      id: 1,
      route_stops: [makeRouteStop({ routeInternalId: 10, agencyId: 1 })],
      census_geographies: [
        { id: 1, geoid: '100', layer_name: 'tract', name: 'Tract 100' },
        { id: 2, geoid: '100-1', layer_name: 'blockgroup', name: 'BG 100-1' },
      ] as unknown as Stop['census_geographies'],
      visits: makeVisitSummary({ total: counts(5, 1) }),
    })

    const byTract = stopGeoAggregateCsv([stop], 'tract')
    expect(byTract).toHaveLength(1)
    expect(byTract[0]?.geoid).toBe('100')
    expect(byTract[0]?.layer_name).toBe('tract')

    const byBg = stopGeoAggregateCsv([stop], 'blockgroup')
    expect(byBg).toHaveLength(1)
    expect(byBg[0]?.geoid).toBe('100-1')
    expect(byBg[0]?.layer_name).toBe('blockgroup')

    // Unknown layer: no match
    expect(stopGeoAggregateCsv([stop], 'county')).toHaveLength(0)
  })

  it('emits 0 when stops in the geography have no visits set', () => {
    const stop = makeStop({
      id: 1,
      route_stops: [makeRouteStop({ routeInternalId: 10, agencyId: 1 })],
      census_geographies: [tract('100')] as unknown as Stop['census_geographies'],
    })
    const result = stopGeoAggregateCsv([stop], 'tract')
    expect(result[0]?.visit_count_total).toBe(0)
  })
})
