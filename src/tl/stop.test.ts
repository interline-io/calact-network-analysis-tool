import { describe, it, expect } from 'vitest'
import { stopToStopCsv, stopGeoAggregateCsv } from './stop'
import { routesById } from './route'
import type { RouteGql } from './route'
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

// route_stops carry scalar ids; the route's name and type come off the routes
// the routes phase fetches. Both halves come from one description.
function makeRouteStops (args: RouteStopArgs[]) {
  return args.map(a => ({ route_id: a.routeInternalId, agency_id: a.agencyId }))
}

function makeRouteLookup (args: RouteStopArgs[]): Map<number, RouteGql> {
  return routesById(args.map(a => ({
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
  }) as unknown as RouteGql))
}

const ROUTE_10: RouteStopArgs[] = [{ routeInternalId: 10, agencyId: 1 }]
const ROUTES_A: RouteStopArgs[] = [
  { routeInternalId: 10, agencyId: 1 },
  { routeInternalId: 11, agencyId: 1 },
]
const ROUTES_TWO_AGENCIES: RouteStopArgs[] = [
  { routeInternalId: 10, agencyId: 1 },
  { routeInternalId: 11, agencyId: 1 },
  { routeInternalId: 12, agencyId: 2 },
]
const ROUTES_MIXED_MODES: RouteStopArgs[] = [
  { routeInternalId: 10, agencyId: 1, routeType: 3 }, // Bus
  { routeInternalId: 11, agencyId: 1, routeType: 3 }, // Bus dup
  { routeInternalId: 12, agencyId: 2, routeType: 0 }, // Tram
]
const AGG_ROUTES: RouteStopArgs[] = [
  { routeInternalId: 10, agencyId: 1 },
  { routeInternalId: 11, agencyId: 2 },
  { routeInternalId: 12, agencyId: 1 },
]

function makeStop (partial: Partial<Stop> & { id: number }): Stop {
  return {
    id: partial.id,
    geometry: partial.geometry ?? { type: 'Point', coordinates: [-122.68, 45.52] },
    location_type: partial.location_type ?? 0,
    stop_id: partial.stop_id ?? `stop-${partial.id}`,
    stop_name: partial.stop_name ?? `Stop ${partial.id}`,
    route_stops: partial.route_stops ?? [],
    census_geographies: partial.census_geographies ?? [],
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
      route_stops: makeRouteStops(ROUTES_A),
      visits: makeVisitSummary({
        total: counts(42, 5),
        monday: counts(10, 1),
        tuesday: counts(8, 1),
        wednesday: counts(9, 1),
        thursday: counts(8, 1),
        friday: counts(7, 1),
      }),
    })

    const csv = stopToStopCsv(stop, makeRouteLookup(ROUTES_A))
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
      route_stops: makeRouteStops(ROUTE_10),
      visits: makeVisitSummary({ total: counts(0, 5) }),
    })
    expect(stopToStopCsv(stop, makeRouteLookup(ROUTE_10)).visit_count_total).toBe(0)
  })

  it('leaves visit_count_total undefined when stop.visits is missing', () => {
    const stop = makeStop({ id: 3 })
    expect(stopToStopCsv(stop, new Map()).visit_count_total).toBeUndefined()
  })

  it('counts agencies uniquely when multiple routes share an agency', () => {
    const stop = makeStop({
      id: 4,
      route_stops: makeRouteStops(ROUTES_TWO_AGENCIES),
    })
    const csv = stopToStopCsv(stop, makeRouteLookup(ROUTES_TWO_AGENCIES))
    // Pre-existing behavior: routes_count is the raw route_stops length
    // (not filter-aware, not de-duped). Tracked as #239 follow-up.
    expect(csv.routes_count).toBe(3)
    expect(csv.agencies_count).toBe(2)
  })

  it('joins unique route modes in routes_modes', () => {
    const stop = makeStop({
      id: 5,
      route_stops: makeRouteStops(ROUTES_MIXED_MODES),
    })
    const modes = stopToStopCsv(stop, makeRouteLookup(ROUTES_MIXED_MODES)).routes_modes.split(',').map(s => s.trim()).sort()
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
        route_stops: makeRouteStops([AGG_ROUTES[0]!]),
        census_geographies: [tract('100')],
        visits: makeVisitSummary({ total: counts(30, 5) }),
      }),
      makeStop({
        id: 2,
        route_stops: makeRouteStops([AGG_ROUTES[1]!]),
        census_geographies: [tract('100')],
        visits: makeVisitSummary({ total: counts(12, 5) }),
      }),
      makeStop({
        id: 3,
        route_stops: makeRouteStops([AGG_ROUTES[2]!]),
        census_geographies: [tract('200')],
        visits: makeVisitSummary({ total: counts(7, 5) }),
      }),
    ]

    const result = stopGeoAggregateCsv(stops, 'tract', makeRouteLookup(AGG_ROUTES))
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
      route_stops: makeRouteStops(ROUTE_10),
      census_geographies: [
        { id: 1, geoid: '100', layer_name: 'tract', name: 'Tract 100' },
        { id: 2, geoid: '100-1', layer_name: 'bg', name: 'BG 100-1' },
      ],
      visits: makeVisitSummary({ total: counts(5, 1) }),
    })

    const byTract = stopGeoAggregateCsv([stop], 'tract', makeRouteLookup(ROUTE_10))
    expect(byTract).toHaveLength(1)
    expect(byTract[0]?.geoid).toBe('100')
    expect(byTract[0]?.layer_name).toBe('tract')

    const byBg = stopGeoAggregateCsv([stop], 'bg', makeRouteLookup(ROUTE_10))
    expect(byBg).toHaveLength(1)
    expect(byBg[0]?.geoid).toBe('100-1')
    expect(byBg[0]?.layer_name).toBe('bg')

    // Unknown layer: no match
    expect(stopGeoAggregateCsv([stop], 'county', makeRouteLookup(ROUTE_10))).toHaveLength(0)
  })

  it('emits 0 when stops in the geography have no visits set', () => {
    const stop = makeStop({
      id: 1,
      route_stops: makeRouteStops(ROUTE_10),
      census_geographies: [tract('100')],
    })
    const result = stopGeoAggregateCsv([stop], 'tract', makeRouteLookup(ROUTE_10))
    expect(result[0]?.visit_count_total).toBe(0)
  })

  // A stop buffer reaches past the query area, so the buffer pass returns
  // geographies the query-area pass never saw. Without a row seeded for them
  // their demographics are dropped from the table entirely.
  describe('buffer-reached geographies', () => {
    const censusGeographies = new Map([
      ['41051000100', {
        id: 1, name: 'Tract 1', values: {}, intersectionRatio: 1,
        geometryArea: 1000, intersectionArea: 1000,
      }],
    ])
    const bufferGeographies = [
      { geoid: '41051000100', layer: 'tract', name: 'Tract 1', geometryArea: 1000, intersectionArea: 500, values: { b01003_001: 800 } },
      // Outside the query area — only the buffer reaches it.
      { geoid: '41051000200', layer: 'tract', name: 'Tract 2', geometryArea: 1000, intersectionArea: 250, values: { b01003_001: 400 } },
    ]

    it('seeds a row for a geography only the buffer reaches', () => {
      const rows = stopGeoAggregateCsv([], 'tract', new Map(), censusGeographies, {
        aggregationBufferGeographies: bufferGeographies,
      })
      const byGeoid = new Map(rows.map(r => [r.geoid, r]))
      expect([...byGeoid.keys()].sort()).toEqual(['41051000100', '41051000200'])
      // Named from the buffer pass, and apportioned by its own coverage.
      expect(byGeoid.get('41051000200')?.name).toBe('Tract 2')
      expect(byGeoid.get('41051000200')?.total_population).toBeCloseTo(100)
      expect(byGeoid.get('41051000200')?.stops_count).toBe(0)
    })

    it('only seeds at the aggregation layer — finer ones roll up by FIPS prefix', () => {
      const rows = stopGeoAggregateCsv([], 'county', new Map(), new Map(), {
        aggregationBufferGeographies: [
          { geoid: '1400000US41051000200', layer: 'tract', name: 'Tract 2', geometryArea: 1000, intersectionArea: 250, values: {} },
        ],
      })
      expect(rows).toHaveLength(0)
    })

    it('respects onlyWithStops', () => {
      const rows = stopGeoAggregateCsv([], 'tract', new Map(), censusGeographies, {
        onlyWithStops: true,
        aggregationBufferGeographies: bufferGeographies,
      })
      expect(rows).toHaveLength(0)
    })
  })
})
