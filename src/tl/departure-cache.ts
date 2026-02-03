import type { StopTime } from './departure'
import { parseHMS } from '../core/datetime'

/**
 * Compact representation of a departure for internal storage.
 *
 * Memory comparison for 5 million departures:
 * - Full StopTime objects: ~1.25 GB (nested objects, strings, overhead)
 * - CompactDeparture: ~80-100 MB (flat tuple with pre-parsed time)
 *
 * Fields:
 * - [0] departureSeconds: departure time as seconds since midnight (pre-parsed)
 * - [1] routeId: route ID for building route indexes
 * - [2] directionId: 0 or 1
 * - [3] tripId: numeric trip ID (for trip deduplication in WSDOT)
 */
export type CompactDeparture = readonly [
  departureSeconds: number,
  routeId: number,
  directionId: number,
  tripId: number,
]

export const CompactDeparture = {
  fromStopTime: (st: StopTime): CompactDeparture => [
    parseHMS(st.departure_time),
    st.trip.route.id,
    st.trip.direction_id,
    st.trip.id,
  ],
  departureSeconds: (d: CompactDeparture) => d[0],
  routeId: (d: CompactDeparture) => d[1],
  directionId: (d: CompactDeparture) => d[2],
  tripId: (d: CompactDeparture) => d[3],
}

/**
 * Simple two-level cache for stop departures: stopId -> date -> CompactDeparture[]
 * This is the primary data structure for departure lookups by stop.
 *
 * Uses compact tuple representation to minimize memory footprint.
 */
export class StopDepartureCache {
  cache: Map<number, Map<string, CompactDeparture[]>> = new Map()

  get (id: number, date: string): CompactDeparture[] {
    const a = this.cache.get(id) || new Map()
    return a.get(date) || []
  }

  /**
   * Add departures to the cache. Converts StopTime objects to compact representation.
   */
  add (id: number, date: string, value: StopTime[]) {
    if (value.length === 0) {
      return
    }
    const a = this.cache.get(id) || new Map()
    const b = a.get(date) || []
    for (const st of value) {
      b.push(CompactDeparture.fromStopTime(st))
    }
    a.set(date, b)
    this.cache.set(id, a)
  }

  hasService (id: number, date: string): boolean {
    const a = this.cache.get(id)
    if (!a) {
      return false
    }
    return (a.get(date) || []).length > 0
  }
}

/**
 * Inverted index for route-based departure lookups: "routeId|date" -> stopId -> number[]
 * Built on-demand from a StopDepartureCache when route-based queries are needed.
 * Stores only departure seconds (the only field used after indexing).
 */
export class RouteDepartureIndex {
  // Separate caches for each direction, storing only departure seconds
  private cache0: Map<string, Map<number, number[]>> = new Map()
  private cache1: Map<string, Map<number, number[]>> = new Map()

  private constructor () {}

  /**
   * Build a route departure index from a StopDepartureCache.
   * This iterates all departures once to build the inverted index.
   */
  static fromCache (sdCache: StopDepartureCache): RouteDepartureIndex {
    const index = new RouteDepartureIndex()
    for (const [stopId, dateMap] of sdCache.cache.entries()) {
      for (const [date, departures] of dateMap.entries()) {
        for (const dep of departures) {
          const routeId = CompactDeparture.routeId(dep)
          const directionId = CompactDeparture.directionId(dep)
          const depSeconds = CompactDeparture.departureSeconds(dep)
          index.add(routeId, stopId, date, directionId, depSeconds)
        }
      }
    }
    return index
  }

  private add (routeId: number, stopId: number, date: string, directionId: number, depSeconds: number): void {
    const key = `${routeId}|${date}`
    const cache = directionId ? this.cache1 : this.cache0
    const a = cache.get(key) || new Map()
    const b = a.get(stopId) || []
    b.push(depSeconds)
    a.set(stopId, b)
    cache.set(key, a)
  }

  /**
   * Get all departure times (in seconds) for a route on a date, grouped by stop.
   * @param routeId - Route ID
   * @param dir - Direction (0 or 1)
   * @param date - Date string (YYYY-MM-DD)
   * @returns Map of stopId -> departure seconds[]
   */
  getRouteDate (routeId: number, dir: number, date: string): Map<number, number[]> {
    const key = `${routeId}|${date}`
    const cache = dir ? this.cache1 : this.cache0
    return cache.get(key) || new Map<number, number[]>()
  }
}
