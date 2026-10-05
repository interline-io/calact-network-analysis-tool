import { describe, it, expect } from 'vitest'
import { WSDOTStopCollector } from './stops'
import type { StopCensusGeography, StopGql } from '~~/src/tl'

function stop (id: number, over: Partial<StopGql> = {}): StopGql {
  return {
    id,
    stop_id: `s${id}`,
    stop_name: `Stop ${id}`,
    geometry: { type: 'Point', coordinates: [-122.5, 45.5] },
    feed_version: { sha1: 'abc', feed: { onestop_id: 'f-test' } },
    route_stops: [],
    ...over,
  } as unknown as StopGql
}

// What the stop-census phase streams for a stop, at whichever layer it ran at.
const GEOGRAPHIES: [number, StopCensusGeography[]][] = [
  [1, [
    { id: 1, geoid: '53', layer_name: 'state', name: 'Washington' },
    { id: 2, geoid: '53033', layer_name: 'county', name: 'King' },
  ]],
]

describe('WSDOTStopCollector', () => {
  it('keeps the eight values the report reads', () => {
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1)])
    collector.setStateNames(GEOGRAPHIES)
    expect(collector.all[0]).toEqual({
      id: 1,
      gtfsStopId: 's1',
      stopName: 'Stop 1',
      lat: 45.5,
      lon: -122.5,
      feedOnestopId: 'f-test',
      feedVersionSha1: 'abc',
      stateName: 'Washington',
    })
  })

  it('takes the name from the aggregation layer, not the first geography', () => {
    const collector = new WSDOTStopCollector('county')
    collector.add([stop(1)])
    collector.setStateNames(GEOGRAPHIES)
    expect(collector.all[0]?.stateName).toBe('King')
  })

  it('leaves the name empty when the layer is absent', () => {
    const collector = new WSDOTStopCollector('tract')
    collector.add([stop(1)])
    collector.setStateNames(GEOGRAPHIES)
    expect(collector.all[0]?.stateName).toBe('')
  })

  it('leaves the name empty when no census arrives at all', () => {
    // The stop-census phase is skipped without an aggregation layer, and the
    // report still has to produce a row for every stop.
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1)])
    expect(collector.all[0]?.stateName).toBe('')
  })

  it('ignores geographies for a stop it never collected', () => {
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1)])
    collector.setStateNames([[99, [{ id: 1, geoid: '53', layer_name: 'state', name: 'Washington' }]]])
    expect(collector.size).toBe(1)
    expect(collector.all[0]?.stateName).toBe('')
  })

  it('marks a stop with no geometry so the table can skip it', () => {
    // The cache-based path filtered on `stop.geometry` before building a row.
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1, { geometry: undefined as unknown as StopGql['geometry'] })])
    expect(collector.all[0]?.lat).toBeNull()
    expect(collector.all[0]?.lon).toBeNull()
  })

  it('keeps one record per stop id across batches', () => {
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1), stop(2)])
    collector.add([stop(2), stop(3)])
    expect(collector.size).toBe(3)
    expect([...collector.gtfsIds().keys()]).toEqual([1, 2, 3])
  })

  it('exposes every stop as a frequency label, with or without geometry', () => {
    // The frequency maps are built over this domain, so a stop the table skips
    // still needs to be present.
    const collector = new WSDOTStopCollector('state')
    collector.add([stop(1), stop(2, { geometry: undefined as unknown as StopGql['geometry'] })])
    expect(collector.gtfsIds()).toEqual(new Map([[1, 's1'], [2, 's2']]))
  })
})
