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
 * A feed can split one route into several rows, such as one per branch, which
 * no single row covers, so a route also counts as a copy of a feed's rows when
 * its trips run in all of them together (the feed_ fields). Partial, disjoint
 * and no-trips relationships are never collapsed. A route with no trips on
 * those dates is already unmarked by the service filters, and hiding it would
 * need evidence that it is a copy.
 *
 * Copies form groups. In each group the routes of one feed are kept, chosen by,
 * in order:
 *   1. any of its routes passes the current filters, so filtering to the
 *      agency, mode or fare of one copy never makes the route vanish;
 *   2. the fewest agencies in the scenario, so an agency's own feed is kept
 *      over a feed that also carries other agencies' routes;
 *   3. the newest timetable (the latest start of its feed version's calendar),
 *      so an agency's current edition is kept over another publisher's older
 *      copy, which can run more trips because it predates a service cut;
 *   4. the most trips on the group's routes over the compared dates;
 *   5. the most routes in the scenario, so a flex build is kept over the plain
 *      build it extends;
 *   6. the feed Onestop ID, compared by code point.
 * A route from another feed is hidden only when its trips run in a kept route,
 * or in all of the kept feed's rows in the group together.
 *
 * Applied in the result filter after routes are marked and before stops,
 * departures and clusters are derived, so every browse report, count, map layer
 * and export sees one copy; and in the WSDOT reports, which take the copies out
 * of their own folded records (src/analysis/wsdot/duplicates.ts).
 */

import { StopDepartureCache, type StopTimeCacheItem } from '~~/src/tl/departure-cache'
import { routesById, type RouteGql, type RouteTripRelationship, type StopGql } from '~~/src/tl'
import { groupBy } from '~~/src/core/collections'

// How a hidden copy relates to the kept route it runs in.
//   same-trips: each runs the other's trips
//   subset:     its trips are among the kept route's, which runs more
export type DuplicateRouteRelationship = 'same-trips' | 'subset'

// A route's trips running in another's, over the compared dates.
interface RunsIn {
  relationship: DuplicateRouteRelationship
  matchedTrips: number
  trips: number
}

// A hidden copy, against the first of the kept routes its trips run in.
export interface CollapsedRoute extends RunsIn {
  // The kept routes its trips run in, most matched trips first.
  keptRouteIds: number[]
}

// A route as the collapse summary names it.
export interface CollapsedRouteRef {
  id: number
  name: string
  agencyName: string
  feedOnestopId: string
}

export interface CollapsedRouteSummary extends RunsIn {
  route: CollapsedRouteRef
  kept: CollapsedRouteRef[]
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

// From a route's side, the relationships in which its trips run in the
// other's, and those in which the other's run in its own.
const RUNS_IN: Partial<Record<RouteTripRelationship, DuplicateRouteRelationship>> = { SAME_TRIPS: 'same-trips', SUBSET: 'subset' }
const RUN_IN_BY: Partial<Record<RouteTripRelationship, DuplicateRouteRelationship>> = { SAME_TRIPS: 'same-trips', SUPERSET: 'subset' }
const relationshipOf = (table: typeof RUNS_IN, rel: string | null | undefined) => rel ? table[rel as RouteTripRelationship] : undefined

// Set outer[a][b] unless it is already set: a route's first report wins.
function setFirst<K, V> (outer: Map<number, Map<K, V>>, a: number, b: K, value: V) {
  let inner = outer.get(a)
  if (!inner) {
    inner = new Map<K, V>()
    outer.set(a, inner)
  }
  if (!inner.has(b)) {
    inner.set(b, value)
  }
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
  const byId = routesById(routes)

  // runsIn.get(a)?.get(b): a's trips run in b's.
  const runsIn = new Map<number, Map<number, RunsIn>>()
  // runsInFeed.get(a)?.get(feed): a's trips run in that feed's rows together.
  const runsInFeed = new Map<number, Map<string, RunsIn>>()
  const tripsOf = new Map<number, number>()
  const parent = new Map<number, number>()
  // Routes joined to another, through either kind of relationship.
  const linked = new Set<number>()
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
      const matchedTrips = s.matched_trips ?? 0
      const into = relationshipOf(RUNS_IN, s.relationship)
      const by = relationshipOf(RUN_IN_BY, s.relationship)
      const intoFeed = relationshipOf(RUNS_IN, s.feed_relationship)
      const byFeed = relationshipOf(RUN_IN_BY, s.feed_relationship)
      if (into) {
        setFirst(runsIn, route.id, other.id, { relationship: into, matchedTrips, trips: s.trips ?? 0 })
      }
      if (by) {
        setFirst(runsIn, other.id, route.id, { relationship: by, matchedTrips, trips: s.other_trips ?? 0 })
      }
      if (intoFeed) {
        setFirst(runsInFeed, route.id, feedOf(other), { relationship: intoFeed, matchedTrips: s.feed_matched_trips ?? 0, trips: s.trips ?? 0 })
      }
      if (into || by || intoFeed || byFeed) {
        parent.set(find(route.id), find(other.id))
        linked.add(route.id)
        linked.add(other.id)
      }
    }
  }
  if (linked.size === 0) {
    return ret
  }

  // Scenario-wide feed facts for the keeper.
  const feedAgencies = new Map<string, Set<number>>()
  const feedRoutes = new Map<string, number>()
  const feedStart = new Map<string, string>()
  for (const [feed, feedRouteList] of groupBy(routes, feedOf)) {
    feedRoutes.set(feed, feedRouteList.length)
    feedAgencies.set(feed, new Set(feedRouteList.map(r => r.agency?.id)))
    feedStart.set(feed, feedRouteList.reduce((latest, r) => {
      const start = r.feed_version?.earliest_calendar_date || ''
      return start > latest ? start : latest
    }, ''))
  }

  for (const ids of groupBy(linked, find).values()) {
    const group = ids.map(id => byId.get(id)!)
    const byFeed = groupBy(group, feedOf)
    if (byFeed.size < 2) {
      continue
    }
    const anyMarked = (feed: string) => byFeed.get(feed)!.some(r => marked(r.id))
    const trips = (feed: string) => byFeed.get(feed)!.reduce((n, r) => n + (tripsOf.get(r.id) || 0), 0)
    const feeds = [...byFeed.keys()].sort((a, b) =>
      Number(anyMarked(b)) - Number(anyMarked(a))
      || (feedAgencies.get(a)?.size || 0) - (feedAgencies.get(b)?.size || 0)
      || compareCodePoints(feedStart.get(b) || '', feedStart.get(a) || '')
      || trips(b) - trips(a)
      || (feedRoutes.get(b) || 0) - (feedRoutes.get(a) || 0)
      || compareCodePoints(a, b))
    const keptFeed = feeds[0]!
    const kept = new Set(byFeed.get(keptFeed)!.map(r => r.id))
    for (const route of group) {
      if (kept.has(route.id)) {
        continue
      }
      const into = [...(runsIn.get(route.id) || new Map<number, RunsIn>()).entries()]
        .filter(([other]) => kept.has(other))
        .sort(([ia, a], [ib, b]) => b.matchedTrips - a.matchedTrips || ia - ib)
      if (into.length > 0) {
        ret.set(route.id, { ...into[0]![1], keptRouteIds: into.map(([other]) => other) })
        continue
      }
      // No single kept row covers it; the kept feed's rows together may.
      const together = runsInFeed.get(route.id)?.get(keptFeed)
      if (together) {
        ret.set(route.id, { ...together, keptRouteIds: [...kept].sort((a, b) => a - b) })
      }
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
  // Departures without the hidden copies' trips. The same object for as long as
  // the same copies are hidden and no departures arrive.
  stopDepartureCache: StopDepartureCache
}

function routeRef (route: RouteGql): CollapsedRouteRef {
  return {
    id: route.id,
    name: route.route_short_name || route.route_long_name || route.route_id,
    agencyName: route.agency?.agency_name || 'Unknown',
    feedOnestopId: feedOf(route),
  }
}

// The departures with hidden copies removed, per scenario cache, so refiltering
// without changing what is hidden hands views the same cache: views that watch
// the cache for a new scenario (the Transfer Analyst) would otherwise reset on
// every filter edit. Keyed on the source's version as well as the hidden
// routes, since a streaming scenario adds departures to the same cache.
const collapsedCaches = new WeakMap<StopDepartureCache, { key: string, cache: StopDepartureCache }>()

function collapsedDepartures (source: StopDepartureCache, collapsed: Map<number, CollapsedRoute>, touched: Map<number, boolean>): StopDepartureCache {
  const key = `${source.version}:${[...collapsed.keys()].sort((a, b) => a - b).join(',')}`
  const memo = collapsedCaches.get(source)
  if (memo && memo.key === key) {
    return memo.cache
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
  collapsedCaches.set(source, { key, cache })
  return cache
}

/**
 * The hidden copies as the collapse lists them, by agency and route name.
 */
export function collapsedRouteSummaries (routes: RouteGql[], collapsed: Map<number, CollapsedRoute>): CollapsedRouteSummary[] {
  const routeById = routesById(routes)
  const summaries: CollapsedRouteSummary[] = [...collapsed].map(([id, { keptRouteIds, ...runsIn }]) => ({
    ...runsIn,
    route: routeRef(routeById.get(id)!),
    kept: keptRouteIds.map(k => routeRef(routeById.get(k)!)),
  }))
  return summaries.sort((a, b) =>
    compareCodePoints(a.route.agencyName, b.route.agencyName)
    || compareCodePoints(a.route.name, b.route.name)
    || a.route.id - b.route.id)
}

/**
 * The stops without those only hidden routes serve, and with hidden routes left
 * out of the rest's route_stops. `touched` maps each stop a hidden route served
 * to whether it was removed.
 */
export function withoutCollapsedRoutes<T extends Pick<StopGql, 'id' | 'route_stops'>> (
  stops: T[],
  hidden: { has: (routeId: number) => boolean },
): { stops: T[], touched: Map<number, boolean> } {
  const kept: T[] = []
  const touched = new Map<number, boolean>()
  for (const stop of stops) {
    const routeStops = stop.route_stops || []
    if (!routeStops.some(rs => hidden.has(rs.route_id))) {
      kept.push(stop)
      continue
    }
    const remaining = routeStops.filter(rs => !hidden.has(rs.route_id))
    touched.set(stop.id, remaining.length === 0)
    if (remaining.length > 0) {
      kept.push({ ...stop, route_stops: remaining })
    }
  }
  return { stops: kept, touched }
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
  const { stops, touched } = withoutCollapsedRoutes(data.stops, collapsed)
  return {
    collapsed,
    summaries: collapsedRouteSummaries(data.routes, collapsed),
    stops,
    stopDepartureCache: collapsedDepartures(data.stopDepartureCache, collapsed, touched),
  }
}
