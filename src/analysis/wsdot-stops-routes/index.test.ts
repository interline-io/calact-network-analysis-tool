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
      levelGeometry: {},
      bboxIntersection: [],
      collapsedRoutes: [],
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
      levelGeometry: {},
      bboxIntersection: [],
      collapsedRoutes: [],
    }
    const out = processWsdotStopsRoutesReport(data, report)
    expect(out.stops.find(s => s.feedOnestopId === 'f-busy')?.level2).toBe(1)
    expect(out.stops.find(s => s.feedOnestopId === 'f-rural')?.level2).toBe(0)
  })
})

describe('processWsdotStopsRoutesReport duplicate routes', () => {
  it('leaves out the copies the WSDOT report hid, and the stops only they serve', () => {
    // Route 2 is a copy of route 1 published by another feed. Stop 202 is the
    // copy's alone; stop 203 is also served by route 3 of the copy's feed.
    const route = (id: number, agencyId: number, feed: string) => ({
      id,
      route_id: `r${id}`,
      agency: { id: agencyId, agency_id: `a${agencyId}`, agency_name: `Agency ${agencyId}` },
      feed_version: { sha1: `sha-${feed}`, feed: { onestop_id: feed } },
    })
    const data = {
      stops: [
        scenarioStop(101, '1', 'f-own'),
        { ...scenarioStop(202, '1', 'f-copy'), route_stops: [{ route_id: 2, agency_id: 2 }] },
        { ...scenarioStop(203, '2', 'f-copy'), route_stops: [{ route_id: 2, agency_id: 2 }, { route_id: 3, agency_id: 3 }] },
      ],
      routes: [route(1, 1, 'f-own'), route(2, 2, 'f-copy'), route(3, 3, 'f-copy')],
    } as unknown as ScenarioData
    const ref = (id: number, feed: string) => ({ id, name: `R${id}`, agencyName: `Agency ${id}`, feedOnestopId: feed })
    const report: WSDOTReport = {
      stops: [],
      levelStops: {},
      levelLayers: {},
      levelGeometry: {},
      bboxIntersection: [],
      collapsedRoutes: [{ route: ref(2, 'f-copy'), kept: [ref(1, 'f-own')], relationship: 'same-trips', matchedTrips: 4, trips: 4 }],
    }
    const out = processWsdotStopsRoutesReport(data, report)
    expect(out.routes.map(r => r.routeId).sort()).toEqual(['r1', 'r3'])
    expect(out.stops.map(s => `${s.feedOnestopId}:${s.stopId}`).sort()).toEqual(['f-copy:2', 'f-own:1'])
    // The shared stop is credited to the route that stays, not the copy's agency.
    expect(out.stops.find(s => s.feedOnestopId === 'f-copy')?.agencyId).toBe('f-copy:a3')
    expect(out.agencies.map(a => a.agencyId).sort()).toEqual(['f-copy:a3', 'f-own:a1'])
    expect(out.collapsedRoutes).toHaveLength(1)
  })
})
