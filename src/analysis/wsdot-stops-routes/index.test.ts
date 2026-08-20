import { describe, it, expect } from 'vitest'
import { processWsdotStopsRoutesReport } from './index'
import type { WSDOTReport, WSDOTStopResult } from '~~/src/analysis/wsdot'
import type { ScenarioData } from '~~/src/scenario'

// GTFS stop_id is unique within a feed, not across feeds. A statewide run
// covers a hundred-odd feeds, so ids like "1" recur constantly.

function scenarioStop (id: number, gtfsStopId: string, feed: string) {
  return {
    id,
    stop_id: gtfsStopId,
    stop_name: `Stop ${gtfsStopId} (${feed})`,
    geometry: { type: 'Point', coordinates: [-122.3, 47.6] },
    feed_version: { sha1: `sha-${feed}`, feed: { onestop_id: feed } },
    route_stops: [{ route_id: 1, agency_id: 1 }],
  }
}

function reportStop (gtfsStopId: string, feed: string, levels: Partial<WSDOTStopResult>): WSDOTStopResult {
  return {
    feedOnestopId: feed,
    feedVersionSha1: `sha-${feed}`,
    stateName: 'Washington',
    stopId: gtfsStopId,
    stopName: `Stop ${gtfsStopId} (${feed})`,
    stopLat: 47.6,
    stopLon: -122.3,
    level6: false, level5: false, level4: false, level3: false,
    level2: false, level1: false, levelNights: false, levelAll: true,
    ...levels,
  }
}

describe('processWsdotStopsRoutesReport service level mapping', () => {
  it('gives each feed its own levels when two feeds share a GTFS stop_id', () => {
    // The busy feed's stop and the rural feed's stop are both "1". Keying the
    // lookup by that string alone lets one feed's levels overwrite the other's,
    // and every colliding stop then reports whichever feed happened to be last.
    const data = {
      stops: [scenarioStop(101, '1', 'f-busy'), scenarioStop(202, '1', 'f-rural')],
      routes: [{
        id: 1,
        route_id: 'r1',
        agency: { id: 1, agency_id: 'a', agency_name: 'A' },
      }] as unknown as ScenarioData['routes'],
    } as unknown as ScenarioData

    const report: WSDOTReport = {
      stops: [
        reportStop('1', 'f-busy', { level1: true, level2: true }),
        reportStop('1', 'f-rural', {}),
      ],
      levelStops: {},
      levelLayers: {},
      bboxIntersection: [],
    }

    const out = processWsdotStopsRoutesReport(data, report)
    const busy = out.stops.find(s => s.feedOnestopId === 'f-busy')
    const rural = out.stops.find(s => s.feedOnestopId === 'f-rural')

    expect(busy?.level1).toBe(1)
    expect(busy?.level2).toBe(1)
    expect(rural?.level1).toBe(0)
    expect(rural?.level2).toBe(0)
  })

  it('still maps levels when stop ids do not collide', () => {
    const data = {
      stops: [scenarioStop(101, 'A1', 'f-busy'), scenarioStop(202, 'B1', 'f-rural')],
      routes: [{
        id: 1,
        route_id: 'r1',
        agency: { id: 1, agency_id: 'a', agency_name: 'A' },
      }] as unknown as ScenarioData['routes'],
    } as unknown as ScenarioData
    const report: WSDOTReport = {
      stops: [reportStop('A1', 'f-busy', { level2: true }), reportStop('B1', 'f-rural', {})],
      levelStops: {},
      levelLayers: {},
      bboxIntersection: [],
    }
    const out = processWsdotStopsRoutesReport(data, report)
    expect(out.stops.find(s => s.feedOnestopId === 'f-busy')?.level2).toBe(1)
    expect(out.stops.find(s => s.feedOnestopId === 'f-rural')?.level2).toBe(0)
  })
})
