import { parseHMS } from '../core'
import type { StopTime } from './departure'

/**
 * Compact cache item for stop departures.
 * Uses flat numeric fields instead of nested objects for ~57% memory reduction.
 * - departureTime: seconds since midnight (was string "HH:MM:SS")
 * - tripId: internal numeric trip ID (for deduplication)
 * - directionId: 0 or 1
 * - routeId: internal numeric route ID
 */
export class StopTimeCacheItem {
  constructor (
    public readonly departureTime: number,
    public readonly tripId: number,
    public readonly directionId: number,
    public readonly routeId: number
  ) {}

  /**
   * Convert a GraphQL StopTime response to a compact cache item.
   */
  static fromStopTime (st: StopTime): StopTimeCacheItem {
    return new StopTimeCacheItem(
      parseHMS(st.departure_time),
      st.trip.id,
      st.trip.direction_id,
      st.trip.route.id
    )
  }
}

/**
 * Simple two-level cache for stop departures: stopId -> date -> StopTimeCacheItem[]
 * This is the primary data structure for departure lookups by stop.
 */
export class StopDepartureCache {
  cache: Map<number, Map<string, StopTimeCacheItem[]>> = new Map()

  get (id: number, date: string): StopTimeCacheItem[] {
    const a = this.cache.get(id) || new Map()
    return a.get(date) || []
  }

  /**
   * Add stop times to the cache, converting from GraphQL response format to compact form.
   */
  add (id: number, date: string, value: StopTime[]) {
    if (value.length === 0) {
      return
    }
    const a = this.cache.get(id) || new Map()
    const b = a.get(date) || []
    for (const st of value) {
      b.push(StopTimeCacheItem.fromStopTime(st))
    }
    a.set(date, b)
    this.cache.set(id, a)
  }

  /**
   * Add a single stop time directly from wire format values (no intermediate object).
   * This is more efficient when receiving streaming data.
   */
  addFromWire (stopId: number, date: string, departureTime: number, tripId: number, directionId: number, routeId: number) {
    const a = this.cache.get(stopId) || new Map()
    const b = a.get(date) || []
    b.push(new StopTimeCacheItem(departureTime, tripId, directionId, routeId))
    a.set(date, b)
    this.cache.set(stopId, a)
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
 * Inverted index for route-based departure lookups: "routeId|date" -> stopId -> StopTimeCacheItem[]
 * Built on-demand from a StopDepartureCache when route-based queries are needed.
 * Separates the memory cost from the basic cache - only pay for it when you use it.
 */
export class RouteDepartureIndex {
  // Separate caches for each direction
  private cache0: Map<string, Map<number, StopTimeCacheItem[]>> = new Map()
  private cache1: Map<string, Map<number, StopTimeCacheItem[]>> = new Map()

  private constructor () {}

  /**
   * Build a route departure index from a StopDepartureCache.
   * This iterates all departures once to build the inverted index.
   */
  static fromCache (sdCache: StopDepartureCache): RouteDepartureIndex {
    const index = new RouteDepartureIndex()
    for (const [stopId, dateMap] of sdCache.cache.entries()) {
      for (const [date, departures] of dateMap.entries()) {
        for (const st of departures) {
          index.add(st.routeId, stopId, date, st.directionId, st)
        }
      }
    }
    return index
  }

  private add (routeId: number, stopId: number, date: string, directionId: number, stopTime: StopTimeCacheItem): void {
    const key = `${routeId}|${date}`
    const cache = directionId ? this.cache1 : this.cache0
    const a = cache.get(key) || new Map()
    const b = a.get(stopId) || []
    b.push(stopTime)
    a.set(stopId, b)
    cache.set(key, a)
  }

  /**
   * Get all departures for a route on a date, grouped by stop.
   * @param routeId - Route ID
   * @param dir - Direction (0 or 1)
   * @param date - Date string (YYYY-MM-DD)
   * @returns Map of stopId -> StopTimeCacheItem[]
   */
  getRouteDate (routeId: number, dir: number, date: string): Map<number, StopTimeCacheItem[]> {
    const key = `${routeId}|${date}`
    const cache = dir ? this.cache1 : this.cache0
    return cache.get(key) || new Map<number, StopTimeCacheItem[]>()
  }
}
