import type { StopTime } from './departure'

// TODO: faster representation than formatted string
// (route, date) : stop = count
class stopRouteCache {
  cache: Map<string, Map<number, StopTime[]>> = new Map()
  add (routeId: number, stopId: number, date: string, stopTime: StopTime) {
    const key = `${routeId}|${date}`
    const a = this.cache.get(key) || new Map()
    const b = a.get(stopId) || []
    b.push(stopTime)
    a.set(stopId, b)
    this.cache.set(key, a)
  }

  get (routeId: number, date: string): Map<number, StopTime[]> {
    const key = `${routeId}|${date}`
    return this.cache.get(key) || new Map<number, StopTime[]>()
  }
}

// Two level cache
export class StopDepartureCache {
  cache: Map<number, Map<string, StopTime[]>> = new Map()
  routeCache0: stopRouteCache = new stopRouteCache()
  routeCache1: stopRouteCache = new stopRouteCache()

  get (id: number, date: string): StopTime[] {
    const a = this.cache.get(id) || new Map()
    return a.get(date) || []
  }

  add (id: number, date: string, value: StopTime[]) {
    // TODO: Ensure it's kept sorted
    // By default StopTimes are sorted by time but should not be assumed
    if (value.length === 0) {
      return
    }
    const a = this.cache.get(id) || new Map()
    const b = a.get(date) || []
    b.push(...value)
    a.set(date, b)
    this.cache.set(id, a)

    // Populate route cache
    for (const sd of value) {
      const dirCache = sd.trip.direction_id ? this.routeCache1 : this.routeCache0
      dirCache.add(sd.trip.route.id, id, date, sd)
    }
  }

  hasService (id: number, date: string): boolean {
    const a = this.cache.get(id)
    if (!a) {
      return false
    }
    return (a.get(date) || []).length > 0
  }

  getRouteDate (routeId: number, dir: number, date: string): Map<number, StopTime[]> {
    const dirCache = dir ? this.routeCache1 : this.routeCache0
    return dirCache.get(routeId, date)
  }

  debugStats () {
    let total = 0
    const dates = new Set()
    for (const [_, stopDates] of this.cache) {
      for (const [d, departures] of stopDates) {
        dates.add(d)
        total += departures.length
      }
    }
    console.log('StopDepartureCache stats:', this.cache.size, 'stops', dates.size, 'dates', total, 'total departures')
    console.log('StopDepartureCache routeCache 0:', this.routeCache0)
    console.log('StopDepartureCache routeCache 1:', this.routeCache1)
  }
}
