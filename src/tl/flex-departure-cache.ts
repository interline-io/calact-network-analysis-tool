/**
 * Simple cache tracking which dates each flex location has active service.
 *
 * Maps internal numeric location IDs to sets of YYYY-MM-DD date strings.
 * Used by flexAreaMarked() to support day-of-week filtering, mirroring the
 * StopDepartureCache pattern used for fixed-route transit.
 */
export class FlexDepartureCache {
  cache: Map<number, Set<string>> = new Map()

  add (locationId: number, date: string): void {
    let dates = this.cache.get(locationId)
    if (!dates) {
      dates = new Set()
      this.cache.set(locationId, dates)
    }
    dates.add(date)
  }

  hasService (locationId: number, date: string): boolean {
    return this.cache.get(locationId)?.has(date) ?? false
  }
}
