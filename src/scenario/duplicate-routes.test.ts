import { describe, it, expect } from 'vitest'
import { applyScenarioResultFilter } from './scenario-filter'
import { StopDepartureCache } from '../tl/departure-cache'
import { FlexDepartureCache } from '../tl/flex-departure-cache'
import type { ScenarioConfig, ScenarioData, ScenarioFilter } from './scenario'
import type { StopCluster } from './phases/stop-clusters'
import type { RouteGql } from '../tl/route'
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

function makeRoute (id: number, feed: string, onestopId: string, agencyId: number, name = `R${id}`): RouteGql {
  return {
    id,
    onestop_id: onestopId,
    route_id: `route-${id}`,
    route_short_name: name,
    route_long_name: '',
    route_type: 3,
    agency: { id: agencyId, agency_id: `agency-${agencyId}`, agency_name: `Agency ${agencyId}` },
    feed_version: { sha1: `sha1-${feed}`, feed: { onestop_id: feed } },
  }
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

// One trip per start time on every date, calling at each stop two minutes
// after the last.
function addTrips (cache: StopDepartureCache, routeId: number, stopIds: number[], starts: number[], tripBase: number, dates = DATES) {
  for (const date of dates) {
    starts.forEach((start, i) => {
      stopIds.forEach((stopId, j) => {
        cache.addFromWire(stopId, date, start + j * 120, tripBase + i, 0, routeId)
      })
    })
  }
}

function makeData (routes: RouteGql[], stops: StopGql[], cache: StopDepartureCache, stopClusters?: StopCluster[]): ScenarioData {
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

const OSID = 'r-9rbj-coasttovalleyexpress'

describe('duplicate route collapse', () => {
  it('hides a copy that runs the same trips, keeping the feed with more routes', () => {
    // A plain build (one route) and its flex build (the same route plus another).
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10, 11], [8 * H, 12 * H], 100)
    addTrips(cache, 2, [20, 21], [8 * H, 12 * H], 200)
    addTrips(cache, 3, [22], [9 * H], 300)
    const data = makeData(
      [makeRoute(1, 'f-plain', OSID, 1), makeRoute(2, 'f-flex', OSID, 2), makeRoute(3, 'f-flex', 'r-other', 2)],
      [makeStop(10, 'f-plain', [[1, 1]]), makeStop(11, 'f-plain', [[1, 1]]), makeStop(20, 'f-flex', [[2, 2]]), makeStop(21, 'f-flex', [[2, 2]]), makeStop(22, 'f-flex', [[3, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.routes.map(r => r.id).sort()).toEqual([2, 3])
    expect(result.stops.map(s => s.id).sort()).toEqual([20, 21, 22])
    expect(result.agencies.map(a => a.id)).toEqual([2])
    expect(result.stopDepartureCache.get(10, DATES[0]!)).toEqual([])
    expect(result.collapsedRoutes).toHaveLength(1)
    expect(result.collapsedRoutes[0]).toMatchObject({
      route: { id: 1, feedOnestopId: 'f-plain' },
      kept: [{ id: 2, feedOnestopId: 'f-flex' }],
      relationship: 'same-trips',
    })
  })

  it('keeps an agency\'s own feed over a feed that also carries other agencies', () => {
    // Columbia County Rider's route 1, also published in Tillamook's feed
    // alongside Tillamook's own routes.
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    addTrips(cache, 3, [21], [9 * H], 300)
    addTrips(cache, 4, [22], [10 * H], 400)
    const data = makeData(
      [makeRoute(1, 'f-ccr', 'r-c20-1', 57), makeRoute(2, 'f-tillamook', 'r-c20-1', 57), makeRoute(3, 'f-tillamook', 'r-t-3', 22), makeRoute(4, 'f-tillamook', 'r-t-4', 22)],
      [makeStop(10, 'f-ccr', [[1, 57]]), makeStop(20, 'f-tillamook', [[2, 57]]), makeStop(21, 'f-tillamook', [[3, 22]]), makeStop(22, 'f-tillamook', [[4, 22]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 2, feedOnestopId: 'f-tillamook' }, kept: [{ id: 1, feedOnestopId: 'f-ccr' }] })
  })

  it('hides a copy whose trips are a subset of another feed\'s copy', () => {
    // Coast to Valley Express: one agency publishes 2 of the 3 trips the other does.
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [6 * H, 15 * H], 100)
    addTrips(cache, 2, [20], [6 * H, 8 * H, 15 * H], 200)
    const data = makeData(
      [makeRoute(1, 'f-benton', OSID, 1), makeRoute(2, 'f-lincoln', OSID, 2)],
      [makeStop(10, 'f-benton', [[1, 1]]), makeStop(20, 'f-lincoln', [[2, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.routes.map(r => r.id)).toEqual([2])
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 1 }, relationship: 'subset' })
  })

  it('matches trips that start within the tolerance', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H + 30], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    const data = makeData(
      [makeRoute(1, 'f-a', OSID, 1), makeRoute(2, 'f-b', OSID, 2)],
      [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])],
      cache,
    )
    expect(applyScenarioResultFilter(data, config, {}).collapsedRoutes).toHaveLength(1)
  })

  it('keeps routes that share an ID but run different trips', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [7 * H, 9 * H], 100)
    addTrips(cache, 2, [20], [8 * H, 10 * H], 200)
    const data = makeData(
      [makeRoute(1, 'f-a', 'r-c23nb-easyloop', 1), makeRoute(2, 'f-b', 'r-c23nb-easyloop', 2)],
      [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.routes).toHaveLength(2)
    expect(result.collapsedRoutes).toEqual([])
  })

  it('hides a copy with no trips in the scenario dates when another has some', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 2, [20], [8 * H], 200)
    const data = makeData(
      [makeRoute(1, 'f-stale', OSID, 1), makeRoute(2, 'f-current', OSID, 2)],
      [makeStop(10, 'f-stale', [[1, 1]]), makeStop(20, 'f-current', [[2, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    expect(result.routes.map(r => r.id)).toEqual([2])
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 1 }, relationship: 'no-trips' })
  })

  it('never collapses routes within one feed, or routes with no Onestop ID', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [10], [8 * H], 200)
    addTrips(cache, 3, [20], [8 * H], 300)
    addTrips(cache, 4, [21], [8 * H], 400)
    const data = makeData(
      [makeRoute(1, 'f-a', OSID, 1), makeRoute(2, 'f-a', OSID, 1), makeRoute(3, 'f-a', '', 1), makeRoute(4, 'f-b', '', 2)],
      [makeStop(10, 'f-a', [[1, 1], [2, 1]]), makeStop(20, 'f-a', [[3, 1]]), makeStop(21, 'f-b', [[4, 2]])],
      cache,
    )
    expect(applyScenarioResultFilter(data, config, {}).routes).toHaveLength(4)
  })

  it('compares a copy against every row of the route in the kept feed', () => {
    // One feed splits the route into two rows; the other publishes it as one.
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [7 * H], 100)
    addTrips(cache, 2, [10], [9 * H], 200)
    addTrips(cache, 3, [20], [7 * H, 9 * H], 300)
    const data = makeData(
      [makeRoute(1, 'f-split', OSID, 1), makeRoute(2, 'f-split', OSID, 1), makeRoute(3, 'f-whole', OSID, 2)],
      [makeStop(10, 'f-split', [[1, 1], [2, 1]]), makeStop(20, 'f-whole', [[3, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    // Equal trip totals; f-split has more routes, so it is kept and the whole
    // route, matching the two rows together, goes.
    expect(result.routes.map(r => r.id).sort()).toEqual([1, 2])
    expect(result.collapsedRoutes[0]).toMatchObject({ route: { id: 3 }, kept: [{ id: 1 }, { id: 2 }], relationship: 'same-trips' })
  })

  it('leaves a shared stop in place, without the hidden copy or its departures', () => {
    // f-b's stop 20 serves both its copy of the duplicated route and its own route 4.
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    addTrips(cache, 4, [20], [10 * H, 11 * H], 400)
    const data = makeData(
      [makeRoute(1, 'f-a', OSID, 1), makeRoute(2, 'f-b', OSID, 2), makeRoute(4, 'f-b', 'r-own', 2), makeRoute(5, 'f-a', 'r-a', 1)],
      [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2], [4, 2]])],
      cache,
    )
    const result = applyScenarioResultFilter(data, config, {})
    // Both feeds run the same trips and have two routes each, so the feed id
    // breaks the tie and f-a's copy is kept.
    expect(result.routes.map(r => r.id).sort()).toEqual([1, 4, 5])
    const stop20 = result.stops.find(s => s.id === 20)!
    expect(stop20.route_stops).toEqual([{ route_id: 4, agency_id: 2 }])
    expect(stop20.visits?.total.visit_count).toBe(2 * DATES.length)
  })

  it('drops a stop cluster that was cross-agency only through a hidden copy', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    const cluster: StopCluster = {
      id: 'cluster-1',
      anchorStopId: 10,
      memberStopIds: [10, 20],
      agencyIds: [1, 2],
      routeIds: [1, 2],
      maxDistanceMeters: 100,
      name: 'Stop 10',
    }
    const data = makeData(
      [makeRoute(1, 'f-a', OSID, 1), makeRoute(2, 'f-b', OSID, 2)],
      [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])],
      cache,
      [cluster],
    )
    expect(applyScenarioResultFilter(data, config, {}).stopClusters).toEqual([])
    expect(applyScenarioResultFilter(data, config, { collapseDuplicateRoutes: false }).stopClusters).toHaveLength(1)
  })

  it('shows every copy when turned off, and collapses nothing before departures load', () => {
    const cache = new StopDepartureCache()
    addTrips(cache, 1, [10], [8 * H], 100)
    addTrips(cache, 2, [20], [8 * H], 200)
    const routes = [makeRoute(1, 'f-a', OSID, 1), makeRoute(2, 'f-b', OSID, 2)]
    const stops = [makeStop(10, 'f-a', [[1, 1]]), makeStop(20, 'f-b', [[2, 2]])]
    const off: ScenarioFilter = { collapseDuplicateRoutes: false }
    const shown = applyScenarioResultFilter(makeData(routes, stops, cache), config, off)
    expect(shown.routes).toHaveLength(2)
    expect(shown.collapsedRoutes).toEqual([])
    const loading = applyScenarioResultFilter(makeData(routes, stops, new StopDepartureCache()), config, {})
    expect(loading.routes).toHaveLength(2)
  })
})
