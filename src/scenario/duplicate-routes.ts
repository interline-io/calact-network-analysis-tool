/**
 * Duplicate route collapse
 *
 * One real route can be published in more than one feed: a Trillium feed and
 * its flex build, an aggregator that copies an agency's routes, an agency feed
 * that also carries a neighbor's service. Each copy is its own route record, so
 * without this the reports list the route twice, the counts include it twice
 * and the map draws it twice.
 *
 * Candidates are routes in different feeds that share a route Onestop ID. In a
 * candidate group the routes of one feed are kept, chosen by, in order:
 *   1. the most trips on the route over the scenario dates;
 *   2. the fewest agencies in the scenario, so an agency's own feed is kept
 *      over a feed that also carries other agencies' routes (a neighbor's
 *      feed, an aggregator);
 *   3. the most routes in the scenario, so a superset build such as a flex
 *      feed is kept over the plain build it extends;
 *   4. the feed Onestop ID.
 * A route from any other feed is hidden only when its trips are
 * found among the kept copies' trips: on the same date, starting within
 * DUPLICATE_ROUTE_START_TOLERANCE_SECONDS, for at least
 * DUPLICATE_ROUTE_TRIP_MATCH_FRACTION of its trips. A copy with no trips in the
 * scenario dates (a stale feed) is hidden when the kept copy has some. Routes
 * that share an ID but run different trips stay, so two agencies' unrelated
 * routes of the same name are never merged.
 *
 * A trip's start is its earliest departure at a stop in the query area, which
 * both copies of a route share. Routes within one feed are never collapsed into
 * each other.
 *
 * Applied in the result filter before anything reads the routes, stops or
 * departures, so every report, count, map layer and export sees one copy.
 */

import { format } from 'date-fns'
import {
  DUPLICATE_ROUTE_START_TOLERANCE_SECONDS,
  DUPLICATE_ROUTE_TRIP_MATCH_FRACTION,
} from '~~/src/core'
import { StopDepartureCache, type RouteDepartureIndex, type StopTimeCacheItem } from '~~/src/tl/departure-cache'
import type { RouteGql, StopGql } from '~~/src/tl'

// How a hidden copy relates to the routes kept in its place.
//   same-trips: each runs the other's trips
//   subset:     its trips are among the kept routes' trips, which run more
//   no-trips:   it runs no trips in the scenario dates
export type DuplicateRouteRelationship = 'same-trips' | 'subset' | 'no-trips'

export interface CollapsedRoute {
  routeId: number
  // The kept feed's routes in the group, most trips first.
  keptRouteIds: number[]
  relationship: DuplicateRouteRelationship
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
}

// Trip start times by date key, each list sorted.
type TripStarts = Map<string, number[]>

function feedOf (route: RouteGql): string {
  return route.feed_version?.feed?.onestop_id || ''
}

function tripStarts (routeId: number, routeIndex: RouteDepartureIndex, dateKeys: string[]): TripStarts {
  const ret: TripStarts = new Map()
  for (const date of dateKeys) {
    const byTrip = new Map<number, number>()
    for (const dir of [0, 1]) {
      for (const items of routeIndex.getRouteDate(routeId, dir, date).values()) {
        for (const st of items) {
          const prev = byTrip.get(st.tripId)
          if (prev == null || st.departureTime < prev) {
            byTrip.set(st.tripId, st.departureTime)
          }
        }
      }
    }
    if (byTrip.size > 0) {
      ret.set(date, [...byTrip.values()].sort((a, b) => a - b))
    }
  }
  return ret
}

function tripCount (starts: TripStarts): number {
  let n = 0
  for (const s of starts.values()) {
    n += s.length
  }
  return n
}

function mergeStarts (all: TripStarts[]): TripStarts {
  const ret: TripStarts = new Map()
  for (const starts of all) {
    for (const [date, s] of starts) {
      ret.set(date, [...(ret.get(date) || []), ...s])
    }
  }
  for (const [date, s] of ret) {
    ret.set(date, s.sort((a, b) => a - b))
  }
  return ret
}

// True when sorted contains a value within tolerance of t.
function hasNear (sorted: number[], t: number, tolerance: number): boolean {
  let lo = 0
  let hi = sorted.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = sorted[mid]!
    if (Math.abs(v - t) <= tolerance) {
      return true
    }
    if (v < t) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return false
}

// Share of a's trips that b also runs: same date, start within tolerance.
function matchFraction (a: TripStarts, b: TripStarts): number {
  let total = 0
  let matched = 0
  for (const [date, starts] of a) {
    const other = b.get(date) || []
    for (const t of starts) {
      total++
      if (hasNear(other, t, DUPLICATE_ROUTE_START_TOLERANCE_SECONDS)) {
        matched++
      }
    }
  }
  return total === 0 ? 0 : matched / total
}

/**
 * Find the routes to hide as copies of a route kept from another feed, keyed by
 * the hidden route's id. Empty until departures have loaded, since without them
 * no copy can be told apart from a different route with the same ID.
 */
export function findDuplicateRoutes (
  routes: RouteGql[],
  routeIndex: RouteDepartureIndex,
  dates: Date[],
): Map<number, CollapsedRoute> {
  const ret = new Map<number, CollapsedRoute>()
  if (!routeIndex.hasDepartures()) {
    return ret
  }
  const groups = new Map<string, RouteGql[]>()
  const feedRouteCounts = new Map<string, number>()
  const feedAgencies = new Map<string, Set<number>>()
  for (const route of routes) {
    const feed = feedOf(route)
    feedRouteCounts.set(feed, (feedRouteCounts.get(feed) || 0) + 1)
    const agencies = feedAgencies.get(feed) || new Set<number>()
    agencies.add(route.agency?.id)
    feedAgencies.set(feed, agencies)
    if (!route.onestop_id) {
      continue
    }
    groups.set(route.onestop_id, [...(groups.get(route.onestop_id) || []), route])
  }
  const dateKeys = dates.map(d => format(d, 'yyyy-MM-dd'))
  for (const group of groups.values()) {
    const byFeed = new Map<string, RouteGql[]>()
    for (const route of group) {
      byFeed.set(feedOf(route), [...(byFeed.get(feedOf(route)) || []), route])
    }
    if (byFeed.size < 2) {
      continue
    }
    const starts = new Map<number, TripStarts>(group.map(r => [r.id, tripStarts(r.id, routeIndex, dateKeys)]))
    const trips = (r: RouteGql) => tripCount(starts.get(r.id)!)
    const feedTrips = (feed: string) => byFeed.get(feed)!.reduce((n, r) => n + trips(r), 0)
    const feeds = [...byFeed.keys()].sort((a, b) =>
      feedTrips(b) - feedTrips(a)
      || (feedAgencies.get(a)?.size || 0) - (feedAgencies.get(b)?.size || 0)
      || (feedRouteCounts.get(b) || 0) - (feedRouteCounts.get(a) || 0)
      || a.localeCompare(b))
    const keptFeed = feeds[0]!
    if (feedTrips(keptFeed) === 0) {
      continue
    }
    const kept = [...byFeed.get(keptFeed)!].sort((a, b) => trips(b) - trips(a) || a.id - b.id)
    const keptStarts = mergeStarts(kept.map(r => starts.get(r.id)!))
    const keptRouteIds = kept.map(r => r.id)
    for (const feed of feeds.slice(1)) {
      for (const route of byFeed.get(feed)!) {
        const own = starts.get(route.id)!
        if (tripCount(own) === 0) {
          ret.set(route.id, { routeId: route.id, keptRouteIds, relationship: 'no-trips' })
          continue
        }
        if (matchFraction(own, keptStarts) < DUPLICATE_ROUTE_TRIP_MATCH_FRACTION) {
          continue
        }
        const relationship = matchFraction(keptStarts, own) >= DUPLICATE_ROUTE_TRIP_MATCH_FRACTION ? 'same-trips' : 'subset'
        ret.set(route.id, { routeId: route.id, keptRouteIds, relationship })
      }
    }
  }
  return ret
}

export interface DuplicateRouteCollapse {
  collapsed: Map<number, CollapsedRoute>
  summaries: CollapsedRouteSummary[]
  // Routes without the hidden copies.
  routes: RouteGql[]
  // Stops without those served only by hidden copies, and with hidden copies
  // left out of every remaining stop's route_stops.
  stops: StopGql[]
  // Departures without the hidden copies' trips.
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

/**
 * Hide duplicate copies of routes from the routes, stops and departures the
 * result filter works from. Undefined when there is nothing to hide, so the
 * caller keeps the scenario data as it is.
 */
export function collapseDuplicateRoutes (
  data: { routes: RouteGql[], stops: StopGql[], stopDepartureCache: StopDepartureCache },
  routeIndex: RouteDepartureIndex,
  dates: Date[],
): DuplicateRouteCollapse | undefined {
  const collapsed = findDuplicateRoutes(data.routes, routeIndex, dates)
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
    })
  }
  summaries.sort((a, b) => a.route.agencyName.localeCompare(b.route.agencyName) || a.route.name.localeCompare(b.route.name) || a.route.id - b.route.id)

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

  // Only stops a hidden copy serves carry its departures, so only those need a
  // filtered copy; the rest share the scenario's own date maps.
  const cache = new StopDepartureCache()
  cache.cache = new Map(data.stopDepartureCache.cache)
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
      const kept = items.filter(st => !collapsed.has(st.routeId))
      if (kept.length > 0) {
        filtered.set(date, kept)
      }
    }
    if (filtered.size > 0) {
      cache.cache.set(stopId, filtered)
    } else {
      cache.cache.delete(stopId)
    }
  }

  return {
    collapsed,
    summaries,
    routes: data.routes.filter(r => !collapsed.has(r.id)),
    stops,
    stopDepartureCache: cache,
  }
}
