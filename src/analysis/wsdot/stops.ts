// Streaming replacement for the retained stop list on the WSDOT path.
//
// The report reads eight values out of a stop and nothing else, so stops are
// folded into a flat record as they stream past rather than kept whole. The
// saving is mostly structural: a StopGql is not one object but six or more,
// with separate allocations behind `geometry`, `feed_version` and
// `route_stops`. Measured against real stops, whole ones cost 971 bytes each
// and the flat record 299, which statewide is 45.9 MB against 14.1 MB.
//
// Two of the strings, the feed onestop id and the feed version sha1, take one
// value per feed version rather than one per stop, so they cost a shared
// reference rather than a copy.

import type { StopCensusGeography, StopGql } from '~~/src/tl'

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
  // Keyed by stop id, which also deduplicates: ids are unique across feed
  // versions, but the table deduplicated defensively and this keeps that
  // property. The key is what lets setStateNames find a record again.
  private readonly records = new Map<number, WSDOTStopRecord>()

  // The census layer whose name becomes a stop's state name. Every other layer
  // is dropped at the fold.
  constructor (private readonly aggregateLayer?: string) {}

  add (stops: readonly StopGql[]): void {
    for (const stop of stops) {
      if (this.records.has(stop.id)) {
        continue
      }
      const coordinates = stop.geometry?.coordinates
      this.records.set(stop.id, {
        id: stop.id,
        gtfsStopId: stop.stop_id,
        stopName: stop.stop_name || '',
        lat: coordinates ? coordinates[1] ?? 0 : null,
        lon: coordinates ? coordinates[0] ?? 0 : null,
        feedOnestopId: stop.feed_version?.feed?.onestop_id,
        feedVersionSha1: stop.feed_version?.sha1,
        stateName: '',
      })
    }
  }

  // Fill in each stop's state name from the stop-census phase, which runs
  // after stop discovery — every record already exists. A stop the phase
  // returned nothing for keeps the empty name it was collected with.
  setStateNames (entries: readonly [number, StopCensusGeography[]][]): void {
    for (const [stopId, geographies] of entries) {
      const record = this.records.get(stopId)
      if (record) {
        record.stateName = geographies.find(g => g.layer_name === this.aggregateLayer)?.name || ''
      }
    }
  }

  get all (): readonly WSDOTStopRecord[] {
    return [...this.records.values()]
  }

  get size (): number {
    return this.records.size
  }

  /** Numeric id -> GTFS stop id, the domain the frequency maps are built over. */
  gtfsIds (): Map<number, string> {
    const ids = new Map<number, string>()
    for (const record of this.records.values()) {
      ids.set(record.id, record.gtfsStopId)
    }
    return ids
  }
}
