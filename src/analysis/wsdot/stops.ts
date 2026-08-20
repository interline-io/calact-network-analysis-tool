// Streaming replacement for the retained stop list on the WSDOT path.
//
// The report reads eight values out of a stop and nothing else, so stops are
// folded into a flat record as they stream past rather than kept whole. The
// saving is mostly structural: a StopGql is not one object but six or more,
// with separate allocations behind `geometry`, `feed_version`,
// `census_geographies` and `route_stops`. Measured against real stops, whole
// ones cost 971 bytes each and the flat record 299, which statewide is 45.9 MB
// against 14.1 MB.
//
// Two of the strings, the feed onestop id and the feed version sha1, take one
// value per feed version rather than one per stop, so they cost a shared
// reference rather than a copy.

import type { StopGql } from '~~/src/tl'

export interface WSDOTStopRecord {
  id: number
  gtfsStopId: string
  stopName: string
  // Null when the stop arrived without geometry. The report's stop table skips
  // those, which is what filtering on `stop.geometry` did before.
  lat: number | null
  lon: number | null
  feedOnestopId: string
  feedVersionSha1: string
  stateName: string
}

export class WSDOTStopCollector {
  private readonly records: WSDOTStopRecord[] = []
  // Stop ids are unique across feed versions, but the table deduplicated
  // defensively and this keeps that property.
  private readonly seen = new Set<number>()

  // The census layer whose name becomes a stop's state name. Every other layer
  // on the stop is dropped at the fold.
  constructor (private readonly aggregateLayer?: string) {}

  add (stops: readonly StopGql[]): void {
    for (const stop of stops) {
      if (this.seen.has(stop.id)) {
        continue
      }
      this.seen.add(stop.id)
      const coordinates = stop.geometry?.coordinates
      this.records.push({
        id: stop.id,
        gtfsStopId: stop.stop_id,
        stopName: stop.stop_name || '',
        lat: coordinates ? coordinates[1] ?? 0 : null,
        lon: coordinates ? coordinates[0] ?? 0 : null,
        feedOnestopId: stop.feed_version?.feed?.onestop_id,
        feedVersionSha1: stop.feed_version?.sha1,
        stateName: (stop.census_geographies || [])
          .find(g => g.layer_name === this.aggregateLayer)?.name || '',
      })
    }
  }

  get all (): readonly WSDOTStopRecord[] {
    return this.records
  }

  get size (): number {
    return this.records.length
  }

  /** Numeric id -> GTFS stop id, the domain the frequency maps are built over. */
  gtfsIds (): Map<number, string> {
    const ids = new Map<number, string>()
    for (const record of this.records) {
      ids.set(record.id, record.gtfsStopId)
    }
    return ids
  }
}
