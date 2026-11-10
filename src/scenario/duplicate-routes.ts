/**
 * Duplicate route collapse
 *
 * One real route can be published in more than one feed: a Trillium feed and
 * its flex build, an aggregator that copies an agency's routes, an agency feed
 * that also carries a neighbor's service. Each copy is its own route record, so
 * without this the reports list the route twice, the counts include it twice
 * and the map draws it twice.
 *
 * Detection is Transitland's: Route.similar_routes reports, for each route, the
 * routes in other feeds sharing its Onestop ID and how their trips compare on
 * the scenario's first week (the routes phase asks for it). Two routes are
 * copies when one's trips run in the other's: SAME_TRIPS, SUBSET or SUPERSET.
 * Partial, disjoint and no-trips relationships are never collapsed. A route
 * with no trips on those dates is already unmarked by the service filters, and
 * hiding it would need evidence that it is a copy.
 *
 * Copies form groups. In each group the routes of one feed are kept, chosen by,
 * in order:
 *   1. any of its routes passes the current filters, so filtering to the
 *      agency, mode or fare of one copy never makes the route vanish;
 *   2. the fewest agencies in the scenario, so an agency's own feed is kept
 *      over a feed that also carries other agencies' routes;
 *   3. the most trips on the group's routes over the compared dates;
 *   4. the most routes in the scenario, so a flex build is kept over the plain
 *      build it extends;
 *   5. the feed Onestop ID, compared by code point.
 * A route from another feed is hidden only when its trips run in a kept route.
 *
 * Applied in the result filter after routes are marked and before stops,
 * departures and clusters are derived, so every report, count, map layer and
 * export sees one copy.
 */

import { StopDepartureCache, RouteDepartureIndex, type StopTimeCacheItem } from '~~/src/tl/departure-cache'
import type { RouteGql, StopGql } from '~~/src/tl'

// How a hidden copy relates to the kept route it runs in.
//   same-trips: each runs the other's trips
//   subset:     its trips are among the kept route's, which runs more
export type DuplicateRouteRelationship = 'same-trips' | 'subset'

export interface CollapsedRoute {
  routeId: number
  // The kept routes its trips run in, most matched trips first.
  keptRouteIds: number[]
  relationship: DuplicateRouteRelationship
  // Over the compared dates, against the first kept route.
  matchedTrips: number
  trips: number
}

// A route as the collapse summary names it.
export interface CollapsedRouteRef {
  id: number
  name: string
  agencyName: string
  feedOnestopId: string
}

export interface CollapsedRouteSummary {
  route: CollapsedRouteRef
  kept: CollapsedRouteRef[]
  relationship: DuplicateRouteRelationship
  matchedTrips: number
  trips: number
}

function feedOf (route: RouteGql): string {
  return route.feed_version?.feed?.onestop_id || ''
}

// Code point order, the same in every locale.
function compareCodePoints (a: string, b: string): number {
  return a < b ? -1 : (a > b ? 1 : 0)
}

/**
 * True when the routes carry Transitland's comparison of copies, so the collapse
 * had something to work from. False before routes load, and for routes fetched
 * without it.
 */
export function duplicateDetectionAvailable (routes: RouteGql[]): boolean {
  return routes.some(r => Array.isArray(r.similar_routes))
}

interface RunsIn {
  relationship: DuplicateRouteRelationship
  matchedTrips: number
  trips: number
}

/**
 * Find the routes to hide as copies of a route kept from another feed, keyed by
 * the hidden route's id. `marked` says whether a route passes the current
 * filters, which the keeper prefers.
 */
export function findDuplicateRoutes (
  routes: RouteGql[],
  marked: (routeId: number) => boolean,
): Map<number, CollapsedRoute> {
  const ret = new Map<number, CollapsedRoute>()
  const byId = new Map(routes.map(r => [r.id, r]))

  // runsIn.get(a)?.get(b): a's trips run in b's.
  const runsIn = new Map<number, Map<number, RunsIn>>()
  const setRunsIn = (a: number, b: number, v: RunsIn) => {
    const m = runsIn.get(a) || new Map<number, RunsIn>()
    if (!m.has(b)) {
      m.set(b, v)
    }
    runsIn.set(a, m)
  }
  const tripsOf = new Map<number, number>()
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let p = parent.get(x) ?? x
    while (p !== (parent.get(p) ?? p)) {
      p = parent.get(p) ?? p
    }
    parent.set(x, p)
    return p
  }
  for (const route of routes) {
    for (const s of route.similar_routes || []) {
      const other = byId.get(s.route?.id)
      if (!other || other.id === route.id || feedOf(other) === feedOf(route)) {
        continue
      }
      if (s.trips != null) {
        tripsOf.set(route.id, s.trips)
      }
      if (s.other_trips != null) {
        tripsOf.set(other.id, s.other_trips)
      }
      const matched = s.matched_trips ?? 0
      if (s.relationship === 'SAME_TRIPS' || s.relationship === 'SUBSET') {
        setRunsIn(route.id, other.id, { relationship: s.relationship === 'SAME_TRIPS' ? 'same-trips' : 'subset', matchedTrips: matched, trips: s.trips ?? 0 })
      }
      if (s.relationship === 'SAME_TRIPS' || s.relationship === 'SUPERSET') {
        setRunsIn(other.id, route.id, { relationship: s.relationship === 'SAME_TRIPS' ? 'same-trips' : 'subset', matchedTrips: matched, trips: s.other_trips ?? 0 })
      }
      if (s.relationship === 'SAME_TRIPS' || s.relationship === 'SUBSET' || s.relationship === 'SUPERSET') {
        parent.set(find(route.id), find(other.id))
      }
    }
  }
  if (runsIn.size === 0) {
    return ret
  }

  // Scenario-wide feed facts for the keeper.
  const feedAgencies = new Map<string, Set<number>>()
  const feedRoutes = new Map<string, number>()
  for (const route of routes) {
    const feed = feedOf(route)
    feedRoutes.set(feed, (feedRoutes.get(feed) || 0) + 1)
    const agencies = feedAgencies.get(feed) || new Set<number>()
    agencies.add(route.agency?.id)
    feedAgencies.set(feed, agencies)
  }

  const groups = new Map<number, RouteGql[]>()
  for (const id of new Set([...runsIn.keys(), ...[...runsIn.values()].flatMap(m => [...m.keys()])])) {
    const route = byId.get(id)
    if (route) {
      const root = find(id)
      groups.set(root, [...(groups.get(root) || []), route])
    }
  }
  for (const group of groups.values()) {
    const byFeed = new Map<string, RouteGql[]>()
    for (const route of group) {
      byFeed.set(feedOf(route), [...(byFeed.get(feedOf(route)) || []), route])
    }
    if (byFeed.size < 2) {
      continue
    }
    const anyMarked = (feed: string) => byFeed.get(feed)!.some(r => marked(r.id))
    const trips = (feed: string) => byFeed.get(feed)!.reduce((n, r) => n + (tripsOf.get(r.id) || 0), 0)
    const feeds = [...byFeed.keys()].sort((a, b) =>
      Number(anyMarked(b)) - Number(anyMarked(a))
      || (feedAgencies.get(a)?.size || 0) - (feedAgencies.get(b)?.size || 0)
      || trips(b) - trips(a)
      || (feedRoutes.get(b) || 0) - (feedRoutes.get(a) || 0)
      || compareCodePoints(a, b))
    const kept = new Set(byFeed.get(feeds[0]!)!.map(r => r.id))
    for (const route of group) {
      if (kept.has(route.id)) {
        continue
      }
      const into = [...(runsIn.get(route.id) || new Map<number, RunsIn>()).entries()]
        .filter(([other]) => kept.has(other))
        .sort(([ia, a], [ib, b]) => b.matchedTrips - a.matchedTrips || ia - ib)
      if (into.length === 0) {
        continue
      }
      const [, first] = into[0]!
      ret.set(route.id, {
        routeId: route.id,
        keptRouteIds: into.map(([other]) => other),
        relationship: first.relationship,
        matchedTrips: first.matchedTrips,
        trips: first.trips,
      })
    }
  }
  return ret
}

export interface DuplicateRouteCollapse {
  collapsed: Map<number, CollapsedRoute>
  summaries: CollapsedRouteSummary[]
  // Stops without those served only by hidden copies, and with hidden copies
  // left out of every remaining stop's route_stops.
  stops: StopGql[]
  // Departures without the hidden copies' trips, and the route index built
  // from them. The same objects for as long as the same copies are hidden.
  stopDepartureCache: StopDepartureCache
  routeIndex: RouteDepartureIndex
}

function routeRef (route: RouteGql): CollapsedRouteRef {
  return {
    id: route.id,
    name: route.route_short_name || route.route_long_name || route.route_id,
    agencyName: route.agency?.agency_name || 'Unknown',
    feedOnestopId: feedOf(route),
  }
}

// The departures with hidden copies removed, per scenario cache and set of
// hidden routes, so refiltering without changing what is hidden hands views the
// same cache and index: views that watch the cache for a new scenario (the
// Transfer Analyst) would otherwise reset on every filter edit.
const collapsedCaches = new WeakMap<StopDepartureCache, { key: string, cache: StopDepartureCache, index: RouteDepartureIndex }>()

function collapsedDepartures (source: StopDepartureCache, collapsed: Map<number, CollapsedRoute>, touched: Map<number, boolean>): { cache: StopDepartureCache, index: RouteDepartureIndex } {
  const key = [...collapsed.keys()].sort((a, b) => a - b).join(',')
  const memo = collapsedCaches.get(source)
  if (memo && memo.key === key) {
    return memo
  }
  // Only stops a hidden copy serves carry its departures, so only those need a
  // filtered copy; the rest share the scenario's own date maps.
  const cache = new StopDepartureCache()
  cache.cache = new Map(source.cache)
  for (const [stopId, removed] of touched) {
    const dateMap = cache.cache.get(stopId)
    if (!dateMap) {
      continue
    }
    if (removed) {
      cache.cache.delete(stopId)
      continue
    }
    const filtered = new Map<string, StopTimeCacheItem[]>()
    for (const [date, items] of dateMap) {
      const keep = items.filter(st => !collapsed.has(st.routeId))
      if (keep.length > 0) {
        filtered.set(date, keep)
      }
    }
    if (filtered.size > 0) {
      cache.cache.set(stopId, filtered)
    } else {
      cache.cache.delete(stopId)
    }
  }
  const ret = { key, cache, index: RouteDepartureIndex.fromCache(cache) }
  collapsedCaches.set(source, ret)
  return ret
}

/**
 * Hide duplicate copies of routes from the stops and departures the result
 * filter works from. Undefined when there is nothing to hide, so the caller
 * keeps the scenario data as it is.
 */
export function collapseDuplicateRoutes (
  data: { routes: RouteGql[], stops: StopGql[], stopDepartureCache: StopDepartureCache },
  marked: (routeId: number) => boolean,
): DuplicateRouteCollapse | undefined {
  const collapsed = findDuplicateRoutes(data.routes, marked)
  if (collapsed.size === 0) {
    return undefined
  }
  const routeById = new Map(data.routes.map(r => [r.id, r]))
  const summaries: CollapsedRouteSummary[] = []
  for (const c of collapsed.values()) {
    summaries.push({
      route: routeRef(routeById.get(c.routeId)!),
      kept: c.keptRouteIds.map(id => routeRef(routeById.get(id)!)),
      relationship: c.relationship,
      matchedTrips: c.matchedTrips,
      trips: c.trips,
    })
  }
  summaries.sort((a, b) =>
    compareCodePoints(a.route.agencyName, b.route.agencyName)
    || compareCodePoints(a.route.name, b.route.name)
    || a.route.id - b.route.id)

  const stops: StopGql[] = []
  const touched = new Map<number, boolean>() // stop id -> removed
  for (const stop of data.stops) {
    const routeStops = stop.route_stops || []
    if (!routeStops.some(rs => collapsed.has(rs.route_id))) {
      stops.push(stop)
      continue
    }
    const remaining = routeStops.filter(rs => !collapsed.has(rs.route_id))
    touched.set(stop.id, remaining.length === 0)
    if (remaining.length > 0) {
      stops.push({ ...stop, route_stops: remaining })
    }
  }
  const { cache, index } = collapsedDepartures(data.stopDepartureCache, collapsed, touched)
  return { collapsed, summaries, stops, stopDepartureCache: cache, routeIndex: index }
}
