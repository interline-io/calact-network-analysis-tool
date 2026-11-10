import { describe, it, expect } from 'vitest'
import { applyScenarioResultFilter } from './scenario-filter'
import { StopDepartureCache } from '../tl/departure-cache'
import { FlexDepartureCache } from '../tl/flex-departure-cache'
import type { ScenarioConfig, ScenarioData, ScenarioFilter } from './scenario'
import type { StopCluster } from './phases/stop-clusters'
import type { RouteGql, RouteTripRelationship } from '../tl/route'
import type { StopGql } from '../tl/stop'

// Mon 2024-01-15 to Fri 2024-01-19.
const config: ScenarioConfig = {
  reportName: 'test',
  startDate: new Date('2024-01-15T00:00:00'),
  endDate: new Date('2024-01-19T00:00:00'),
  geoDatasetName: 'test',
}
const DATES = ['2024-01-15', '2024-01-16', '2024-01-17', '2024-01-18', '2024-01-19']
const H = 3600

// What Route.similar_routes reported for a route: another route, the
// relationship from this route's side, and the trip counts.
interface Similar {
  id: number
  rel: RouteTripRelationship
  trips: number
  other: number
  matched: number
}

function makeRoute (id: number, feed: string, agencyId: number, similar?: Similar[]): RouteGql {
  return {
    id,
    onestop_id: 'r-9rbj-shared',
    route_id: `route-${id}`,
    route_short_name: `R${id}`,
    route_long_name: '',
    route_type: 3,
    agency: { id: agencyId, agency_id: `agency-${agencyId}`, agency_name: `Agency ${agencyId}` },
    feed_version: { sha1: `sha1-${feed}`, feed: { onestop_id: feed } },
    similar_routes: similar?.map(s => ({ route: { id: s.id }, relationship: s.rel, trips: s.trips, other_trips: s.other, matched_trips: s.matched })),
  }
}

// The relationship as each side reports it.
function pair (a: RouteGql, b: RouteGql, rel: RouteTripRelationship, tripsA: number, tripsB: number, matched: number) {
  const back: Record<string, RouteTripRelationship> = { SUBSET: 'SUPERSET', SUPERSET: 'SUBSET' }
  a.similar_routes = [...(a.similar_routes || []), { route: { id: b.id }, relationship: rel, trips: tripsA, other_trips: tripsB, matched_trips: matched }]
  b.similar_routes = [...(b.similar_routes || []), { route: { id: a.id }, relationship: back[rel] || rel, trips: tripsB, other_trips: tripsA, matched_trips: matched }]
}

function makeStop (id: number, feed: string, routes: Array<[routeId: number, agencyId: number]>): StopGql {
  return {
    id,
    geometry: { type: 'Point', coordinates: [-123.1, 44.6] },
    location_type: 0,
    stop_id: `stop-${id}`,
    stop_name: `Stop ${id}`,
    feed_version: { sha1: `sha1-${feed}`, feed: { onestop_id: feed } },
    route_stops: routes.map(([route_id, agency_id]) => ({ route_id, agency_id })),
  }
}

// One trip per start time on every date at each stop, two minutes apart.
function addTrips (cache: StopDepartureCache, routeId: number, stopIds: number[], starts: number[], tripBase: number) {
  for (const date of DATES) {
    starts.forEach((start, i) => {
      stopIds.forEach((stopId, j) => {
        cache.addFromWire(stopId, date, start + j * 120, tripBase + i, 0, routeId)
      })
    })
  }
}

function makeData (routes: RouteGql[], stops: StopGql[], cache = new StopDepartureCache(), stopClusters?: StopCluster[]): ScenarioData {
  return {
    routes,
    stops,
    feedVersions: [],
    stopDepartureCache: cache,
    flexDepartureCache: new FlexDepartureCache(),
    flexAreas: [],
    stopClusters,
  }
}

const ids = (xs: { id: number }[]) => xs.map(x => x.id).sort((a, b) => a - b)

describe('duplicate route collapse', () => {
  it('hides a copy with the same trips, keeping the feed with more routes', () => {
    // A plain build and its flex build, which adds a route.
    const plain = makeRoute(1, 'f-plain', 1)
    const flex = makeRoute(2, 'f-flex', 2)
    pair(plain, flex, 'SAME_TRIPS', 10, 10, 10)
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10, 11], [8 * H, 12 * H], 100)
    addTrips(cache, 2, [20, 21], [8 * H, 12 * H], 200)
    const data = makeData(
      [plain, flex, makeRoute(3, 'f-flex', 2)],
      [makeStop(10, 'f-plain', [[1, 1]]), makeStop(11, 'f-plain', [[1, 1]]), makeStop(20, 'f-flex', [[2, 2]]), makeStop(21, 'f-flex', [[2, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(ids(result.routes)).toEqual([2, 3])
    expect(ids(result.stops)).toEqual([20, 21])
    expect(result.agencies.map(a => a.id)).toEqual([2])
    expect(result.stopDepartureCache.get(10, DATES[0]!)).toEqual([])
    expect(result.collapsedRoutes).toHaveLength(1)
    expect(result.collapsedRoutes[0]).toMatchObject({
      route: { id: 1, feedOnestopId: 'f-plain' },
      kept: [{ id: 2, feedOnestopId: 'f-flex' }],
      relationship: 'same-trips',
      matchedTrips: 10,
      trips: 10,
    })
    expect(result.duplicateDetectionAvailable).toBe(true)
  })

  it('hides a subset copy and keeps the one with more trips when the feeds tie', () => {
    // Coast to Valley Express: one agency publishes 6 of the other's 11 trips.
    const benton = makeRoute(1, 'f-benton', 1)
    const lincoln = makeRoute(2, 'f-lincoln', 2)
    pair(benton, lincoln, 'SUBSET', 6, 11, 6)
    const result = applyScenarioResultFilter(makeData([benton, lincoln], []), config, {})
    expect(ids(result.routes)).toEqual([2])
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 1 }, relationship: 'subset', matchedTrips: 6, trips: 6 })
  })

  it('keeps an agency\'s own feed over a feed that also carries other agencies', () => {
    const own = makeRoute(1, 'f-ccr', 57)
    const neighbor = makeRoute(2, 'f-tillamook', 57)
    pair(own, neighbor, 'SAME_TRIPS', 5, 5, 5)
    const data = makeData([own, neighbor, makeRoute(3, 'f-tillamook', 22), makeRoute(4, 'f-tillamook', 253)], [])
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 2, feedOnestopId: 'f-tillamook' }, kept: [{ id: 1, feedOnestopId: 'f-ccr' }] })
  })

  it('shows both copies rather than hide the agency\'s own feed under a larger copy', () => {
    // The agency's feed drops a holiday the aggregator still runs: its trips run
    // in the aggregator's, but it is kept as the agency's own, and the
    // aggregator's extra trips mean its copy does not run in the kept one.
    const own = makeRoute(1, 'f-own', 1)
    const agg = makeRoute(2, 'f-agg', 1)
    pair(own, agg, 'SUBSET', 40, 50, 40)
    const result = applyScenarioResultFilter(makeData([own, agg, makeRoute(3, 'f-agg', 2)], []), config, {})
    expect(result.routes).toHaveLength(3)
    expect(result.collapsedRoutes).toEqual([])
  })

  it('never collapses partial, disjoint or no-trips relationships', () => {
    for (const rel of ['PARTIAL', 'DISJOINT', 'NO_TRIPS', 'OTHER_NO_TRIPS'] as RouteTripRelationship[]) {
      const a = makeRoute(1, 'f-a', 1)
      const b = makeRoute(2, 'f-b', 2)
      pair(a, b, rel, rel === 'NO_TRIPS' ? 0 : 10, rel === 'OTHER_NO_TRIPS' ? 0 : 10, rel === 'PARTIAL' ? 5 : 0)
      const result = applyScenarioResultFilter(makeData([a, b], []), config, {})
      expect(result.routes, rel).toHaveLength(2)
    }
  })

  it('keeps the copy that passes the agency filter', () => {
    const benton = makeRoute(1, 'f-benton', 1)
    const lincoln = makeRoute(2, 'f-lincoln', 2)
    pair(benton, lincoln, 'SUBSET', 6, 11, 6)
    const filter: ScenarioFilter = { selectedAgencies: ['Agency 1'] }
    const result = applyScenarioResultFilter(makeData([benton, lincoln], []), config, filter)
    // Lincoln's copy does not run in Benton's, so nothing is hidden, and
    // Benton's copy stays marked.
    expect(result.routes.find(r => r.id === 1)?.marked).toBe(true)
    expect(result.collapsedRoutes).toEqual([])
  })

  it('collapses real copies even when an unrelated route shares their Onestop ID', () => {
    const a = makeRoute(1, 'f-a', 1)
    const b = makeRoute(2, 'f-b', 2)
    const unrelated = makeRoute(3, 'f-c', 3)
    pair(a, b, 'SAME_TRIPS', 5, 5, 5)
    pair(a, unrelated, 'DISJOINT', 5, 40, 0)
    pair(b, unrelated, 'DISJOINT', 5, 40, 0)
    const result = applyScenarioResultFilter(makeData([a, b, unrelated], []), config, {})
    expect(ids(result.routes)).toEqual([1, 3])
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 2 }, kept: [{ id: 1 }] })
  })

  it('compares a copy with every row of the route in the kept feed', () => {
    // One feed splits the route into two rows; the other has it as one, whose
    // trips run in each.
    const split1 = makeRoute(1, 'f-split', 1)
    const split2 = makeRoute(2, 'f-split', 1)
    const other = makeRoute(3, 'f-other', 2)
    pair(other, split1, 'SUBSET', 4, 8, 4)
    pair(other, split2, 'SUBSET', 4, 6, 4)
    const result = applyScenarioResultFilter(makeData([split1, split2, other], []), config, {})
    expect(ids(result.routes)).toEqual([1, 2])
    expect(result.collapsedRoutes[0]!.kept.map(k => k.id).sort()).toEqual([1, 2])
  })

  it('leaves a shared stop in place, without the hidden copy or its departures', () => {
    const a = makeRoute(1, 'f-a', 1)
    const b = makeRoute(2, 'f-b', 2)
    pair(a, b, 'SAME_TRIPS', 5, 5, 5)
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    addTrips(cache, 4, [20], [10 * H, 11 * H], 400)
    // Both feeds have one agency; f-a has the more routes, so it is kept.
    const data = makeData(
      [a, b, makeRoute(4, 'f-b', 2), makeRoute(5, 'f-a', 1), makeRoute(6, 'f-a', 1)],
      [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2], [4, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(ids(result.routes)).toEqual([1, 4, 5, 6])
    const stop20 = result.stops.find(s => s.id === 20)!
    expect(stop20.route_stops).toEqual([{ route_id: 4, agency_id: 2 }])
    expect(stop20.visits?.total.visit_count).toBe(2 * DATES.length)
    // The route index the views read has no trips of the hidden copy.
    expect(result.routeIndex?.getRouteDate(2, 0, DATES[0]!).size).toBe(0)
    expect(result.routeIndex?.getRouteDate(4, 0, DATES[0]!).size).toBe(1)
  })

  it('hands back the same departures for as long as the same copies are hidden', () => {
    const a = makeRoute(1, 'f-a', 1)
    const b = makeRoute(2, 'f-b', 2)
    pair(a, b, 'SAME_TRIPS', 5, 5, 5)
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    const data = makeData([a, b, makeRoute(3, 'f-a', 1)], [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])], cache)
    const first = applyScenarioResultFilter(data, config, {})
    const second = applyScenarioResultFilter(data, config, { frequencyUnder: 60 })
    expect(second.stopDepartureCache).toBe(first.stopDepartureCache)
    expect(second.routeIndex).toBe(first.routeIndex)
  })

  it('drops a stop cluster that was cross-agency only through a hidden copy', () => {
    const a = makeRoute(1, 'f-a', 1)
    const b = makeRoute(2, 'f-b', 2)
    pair(a, b, 'SAME_TRIPS', 5, 5, 5)
    const cluster: StopCluster = {
      id: 'cluster-1',
      anchorStopId: 10,
      memberStopIds: [10, 20],
      agencyIds: [1, 2],
      routeIds: [1, 2],
      maxDistanceMeters: 100,
      name: 'Stop 10',
    }
    const data = makeData([a, b, makeRoute(3, 'f-a', 1)], [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])], new StopDepartureCache(), [cluster])
    expect(applyScenarioResultFilter(data, config, {}).stopClusters).toEqual([])
    expect(applyScenarioResultFilter(data, config, { collapseDuplicateRoutes: false }).stopClusters).toHaveLength(1)
  })

  it('shows every copy when turned off, and reports when there was nothing to detect from', () => {
    const a = makeRoute(1, 'f-a', 1)
    const b = makeRoute(2, 'f-b', 2)
    pair(a, b, 'SAME_TRIPS', 5, 5, 5)
    const off = applyScenarioResultFilter(makeData([a, b], []), config, { collapseDuplicateRoutes: false })
    expect(off.routes).toHaveLength(2)
    expect(off.collapsedRoutes).toEqual([])
    // Routes fetched without the comparison carry no similar_routes at all.
    const bare = applyScenarioResultFilter(makeData([makeRoute(1, 'f-a', 1), makeRoute(2, 'f-b', 2)], []), config, {})
    expect(bare.routes).toHaveLength(2)
    expect(bare.duplicateDetectionAvailable).toBe(false)
  })
})
