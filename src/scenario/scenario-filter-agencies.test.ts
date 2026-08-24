import { describe, it, expect } from 'vitest'
import { applyScenarioResultFilter } from './scenario-filter'
import { StopDepartureCache } from '../tl/departure-cache'
import { FlexDepartureCache } from '../tl/flex-departure-cache'
import type { ScenarioData, ScenarioConfig } from './scenario'
import type { RouteGql } from '../tl/route'
import type { StopGql } from '../tl/stop'

const baseConfig: ScenarioConfig = {
  reportName: 'test',
  startDate: new Date('2024-01-15T00:00:00'),
  endDate: new Date('2024-01-19T00:00:00'),
  geoDatasetName: 'test',
}

// Two feeds, each publishing an agency with GTFS agency_id "1" — the id GTFS
// only guarantees unique within a feed, and the most common value there is.
const FEEDS = [
  { feed: 'f-busy', numericAgency: 11, agencyName: 'Metro Transit', routeId: 101, stopIds: [201, 202, 203] },
  { feed: 'f-rural', numericAgency: 22, agencyName: 'Metro Transit', routeId: 102, stopIds: [301] },
]

function makeRoute (feed: string, routeId: number, numericAgency: number, agencyName: string): RouteGql {
  return {
    id: routeId,
    route_id: 'A',
    route_short_name: 'A',
    route_long_name: `Route A (${feed})`,
    route_type: 3,
    geometry: { type: 'MultiLineString', coordinates: [] },
    agency: { id: numericAgency, agency_id: '1', agency_name: agencyName },
    feed_version: { sha1: `${feed}-sha1`, feed: { onestop_id: feed } },
    __typename: 'Route',
  }
}

function makeStop (feed: string, stopId: number, routeId: number, numericAgency: number): StopGql {
  return {
    id: stopId,
    geometry: { type: 'Point', coordinates: [-122.68, 45.52] },
    location_type: 0,
    // Also duplicated across feeds, which is what the per-agency stop counts
    // used to collapse on.
    stop_id: '1',
    stop_name: `Stop ${stopId}`,
    feed_version: { sha1: `${feed}-sha1`, feed: { onestop_id: feed } },
    route_stops: [{ route_id: routeId, agency_id: numericAgency }],
    __typename: 'Stop',
  }
}

function buildData (): ScenarioData {
  return {
    stops: FEEDS.flatMap(f => f.stopIds.map(id => makeStop(f.feed, id, f.routeId, f.numericAgency))),
    routes: FEEDS.map(f => makeRoute(f.feed, f.routeId, f.numericAgency, f.agencyName)),
    feedVersions: [],
    stopDepartureCache: new StopDepartureCache(),
    flexDepartureCache: new FlexDepartureCache(),
    flexAreas: [],
  }
}

describe('agency rollup across feeds', () => {
  it('keeps agencies from different feeds apart when GTFS agency_id collides', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, {})
    expect(result.agencies.map(a => a.id).sort((a, b) => a - b)).toEqual([11, 22])
  })

  it('counts each agency only its own stops and routes', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, {})
    const busy = result.agencies.find(a => a.id === 11)
    const rural = result.agencies.find(a => a.id === 22)
    expect(busy?.stops_count).toBe(3)
    expect(busy?.routes_count).toBe(1)
    expect(rural?.stops_count).toBe(1)
    expect(rural?.routes_count).toBe(1)
  })
})

describe('agency filter across feeds', () => {
  it('selects one of two same-named agencies', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, { selectedAgencies: [11] })
    const marked = result.routes.filter(r => r.marked)
    expect(marked.map(r => r.agency.id)).toEqual([11])
  })

  it('marks nothing when the selection names no agency in the results', () => {
    const result = applyScenarioResultFilter(buildData(), baseConfig, { selectedAgencies: [999] })
    expect(result.routes.some(r => r.marked)).toBe(false)
  })
})
