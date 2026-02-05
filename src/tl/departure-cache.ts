import type { StopTime } from './departure'

/**
 * Simple two-level cache for stop departures: stopId -> date -> StopTime[]
 * This is the primary data structure for departure lookups by stop.
 */
export class StopDepartureCache {
  cache: Map<number, Map<string, StopTime[]>> = new Map()

  get (id: number, date: string): StopTime[] {
    const a = this.cache.get(id) || new Map()
    return a.get(date) || []
  }

  add (id: number, date: string, value: StopTime[]) {
    if (value.length === 0) {
      return
    }
    const a = this.cache.get(id) || new Map()
    const b = a.get(date) || []
    b.push(...value)
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
 * Inverted index for route-based departure lookups: "routeId|date" -> stopId -> StopTime[]
 * Built on-demand from a StopDepartureCache when route-based queries are needed.
 * Separates the memory cost from the basic cache - only pay for it when you use it.
 */
export class RouteDepartureIndex {
  // Separate caches for each direction
  private cache0: Map<string, Map<number, StopTime[]>> = new Map()
  private cache1: Map<string, Map<number, StopTime[]>> = new Map()

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
          index.add(st.trip.route.id, stopId, date, st.trip.direction_id, st)
        }
      }
    }
    return index
  }

  private add (routeId: number, stopId: number, date: string, directionId: number, stopTime: StopTime): void {
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
   * @returns Map of stopId -> StopTime[]
   */
  getRouteDate (routeId: number, dir: number, date: string): Map<number, StopTime[]> {
    const key = `${routeId}|${date}`
    const cache = dir ? this.cache1 : this.cache0
    return cache.get(key) || new Map<number, StopTime[]>()
  }
}
