import { describe, it, expect } from 'vitest'
import {
  deriveStopClusters,
  applyClusterTransferTime,
  stopClusterCsv,
  type ClusterInputStop,
  type StopCluster,
  type StopClusterMeta,
} from './stop-clusters'
import { routesById, type RouteGql, type Stop } from '~~/src/tl'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiFetch, BasicGraphQLClient, parseBbox } from '~~/src/core'
import { runStopClustersPhase } from './stop-clusters'

/**
 * Build a ClusterInputStop. Neighbors are listed one-directionally in the tests;
 * deriveStopClusters treats adjacency as undirected.
 */
function stop (
  id: number,
  agencyIds: number[],
  neighborIds: number[],
  routeIds: number[] = agencyIds.map(a => a * 100 + id),
): ClusterInputStop {
  return { id, agencyIds, routeIds, neighborIds }
}

const DIST = 200

describe('deriveStopClusters', () => {
  it('clusters two nearby stops from different agencies', () => {
    const clusters = deriveStopClusters([
      stop(1, [10], [2]),
      stop(2, [20], [1]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberStopIds).toEqual([1, 2])
    expect(clusters[0]?.agencyIds).toEqual([10, 20])
    expect(clusters[0]?.maxDistanceMeters).toBe(DIST)
  })

  it('does not cluster nearby stops from the same agency', () => {
    const clusters = deriveStopClusters([
      stop(1, [10], [2]),
      stop(2, [10], [1]),
    ], DIST)
    expect(clusters).toHaveLength(0)
  })

  it('does not cluster stops that are not within distance', () => {
    const clusters = deriveStopClusters([
      stop(1, [10], []),
      stop(2, [20], []),
    ], DIST)
    expect(clusters).toHaveLength(0)
  })

  it('includes only one stop per agency (distinct stop per agency)', () => {
    // Agency 10 has two nearby stops (1, 2); agency 20 has one (3). All mutual.
    const clusters = deriveStopClusters([
      stop(1, [10], [2, 3]),
      stop(2, [10], [1, 3]),
      stop(3, [20], [1, 2]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    // One agency-10 stop + the agency-20 stop = 2 members, 2 agencies.
    expect(clusters[0]?.memberStopIds).toHaveLength(2)
    expect(clusters[0]?.agencyIds).toEqual([10, 20])
    expect(clusters[0]?.memberStopIds).toContain(3)
  })

  it('keeps clusters disjoint — a stop belongs to at most one cluster', () => {
    // Stop 3 (agency 30) bridges two pairs but can only join one cluster.
    const clusters = deriveStopClusters([
      stop(1, [10], [2]),
      stop(2, [20], [1, 3]),
      stop(3, [30], [2, 4]),
      stop(4, [40], [3]),
    ], DIST)
    const allMembers = clusters.flatMap(c => c.memberStopIds)
    expect(new Set(allMembers).size).toBe(allMembers.length)
  })

  it('prefers the larger cluster when groupings compete', () => {
    // Anchor 1 reaches 2,3,4 (agencies 10/20/30/40) — a 4-agency hub.
    // Stop 5 (agency 20) is only near stop 4; the big hub should win.
    const clusters = deriveStopClusters([
      stop(1, [10], [2, 3, 4]),
      stop(2, [20], [1]),
      stop(3, [30], [1]),
      stop(4, [40], [1, 5]),
      stop(5, [20], [4]),
    ], DIST)
    const big = clusters.find(c => c.anchorStopId === 1)
    expect(big?.memberStopIds).toEqual([1, 2, 3, 4])
    expect(big?.agencyIds).toEqual([10, 20, 30, 40])
  })

  it('treats a multi-agency stop as covering all its agencies', () => {
    const clusters = deriveStopClusters([
      stop(1, [10, 20], [2]),
      stop(2, [30], [1]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.agencyIds).toEqual([10, 20, 30])
  })

  it('drops a stop whose only agency is already covered by a multi-agency member', () => {
    // Stop 1 serves agencies 10 + 20; stop 2 serves only 20 (already covered by
    // stop 1); stop 3 adds agency 30. Stop 2 brings nothing new, so it is excluded.
    const clusters = deriveStopClusters([
      stop(1, [10, 20], [2, 3]),
      stop(2, [20], [1, 3]),
      stop(3, [30], [1, 2]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberStopIds).toEqual([1, 3])
    expect(clusters[0]?.agencyIds).toEqual([10, 20, 30])
  })

  it('centers a cluster on one of its own stops', () => {
    // Stop 2 is agency 10's busier stop, so it represents agency 10 in every
    // ball, stop 1's included. The lowest-id tie-break alone would anchor the
    // cluster on stop 1 and draw its circle around a stop it does not hold.
    const clusters = deriveStopClusters([
      stop(1, [10], [2, 3], [101]),
      stop(2, [10], [1, 3], [102, 103]),
      stop(3, [20], [1, 2], [201]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberStopIds).toEqual([2, 3])
    expect(clusters[0]?.anchorStopId).toBe(2)
  })

  it('keeps a cross-agency pair whose stops each lose to a busier sibling', () => {
    // A chain Y - X - Z - W, each within distance only of its neighbors: X and
    // Z are the cross-agency pair, but in X's ball agency 10 is Y's (busier),
    // and in Z's ball agency 20 is W's. Starting from the anchor keeps the pair.
    const clusters = deriveStopClusters([
      stop(1, [10], [2], [101, 102, 103]), // Y
      stop(2, [10], [1, 3], [104]), // X
      stop(3, [20], [2, 4], [201]), // Z
      stop(4, [20], [3], [202, 203, 204]), // W
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberStopIds).toEqual([2, 3])
    expect(clusters[0]?.memberStopIds).toContain(clusters[0]?.anchorStopId)
  })

  it('gives a cluster of unnamed stops a generic name', () => {
    const clusters = deriveStopClusters([
      stop(1, [10], [2]),
      stop(2, [20], [1]),
    ], DIST)
    expect(clusters[0]?.name).toBe('Stop cluster 1')
  })

  it('names a cluster for what most of its members\' feeds call the place', () => {
    const clusters = deriveStopClusters([
      { ...stop(1, [10], [2, 3]), name: 'Tacoma', feedOnestopId: 'f-a' },
      { ...stop(2, [20], [1, 3]), name: 'Tacoma Dome Station - Zone H', feedOnestopId: 'f-b' },
      { ...stop(3, [30], [1, 2]), name: 'Tacoma Dome Station', feedOnestopId: 'f-c' },
    ], DIST)
    expect(clusters[0]?.name).toBe('Tacoma Dome Station')
  })

  it('keeps a stop that shares an agency but also contributes a new one', () => {
    // Stop 1 serves 10 + 20, stop 2 serves 20 + 30. Stop 2 shares agency 20 but
    // adds 30, so it is admitted as a member.
    const clusters = deriveStopClusters([
      stop(1, [10, 20], [2]),
      stop(2, [20, 30], [1]),
    ], DIST)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.memberStopIds).toEqual([1, 2])
    expect(clusters[0]?.agencyIds).toEqual([10, 20, 30])
  })
})

describe('applyClusterTransferTime', () => {
  const cluster: StopCluster = {
    id: 'cluster:1',
    anchorStopId: 1,
    memberStopIds: [1, 2],
    agencyIds: [10, 20],
    routeIds: [101, 202],
    maxDistanceMeters: DIST,
    name: 'Main St',
  }
  const meta = new Map<number, StopClusterMeta>([
    [1, { agencyIds: [10], routeIds: [101] }],
    [2, { agencyIds: [20], routeIds: [202] }],
    [3, { agencyIds: [30], routeIds: [303] }],
  ])

  it('returns clusters unchanged when the threshold is falsy', () => {
    const out = applyClusterTransferTime([cluster], undefined, new Map(), meta)
    expect(out).toEqual([cluster])
  })

  it('keeps a cluster whose members depart within the window', () => {
    // 8:00:00 and 8:10:00 — 10 min apart, within a 15 min window.
    const dep = new Map<number, number[]>([
      [1, [8 * 3600]],
      [2, [8 * 3600 + 600]],
    ])
    const out = applyClusterTransferTime([cluster], 15, dep, meta)
    expect(out).toHaveLength(1)
    expect(out[0]?.memberStopIds).toEqual([1, 2])
  })

  it('drops a cluster whose members never depart within the window', () => {
    // 8:00 and 9:00 — 60 min apart, outside a 15 min window.
    const dep = new Map<number, number[]>([
      [1, [8 * 3600]],
      [2, [9 * 3600]],
    ])
    const out = applyClusterTransferTime([cluster], 15, dep, meta)
    expect(out).toHaveLength(0)
  })

  it('prunes a member with no in-window partner and drops the cluster below 2 agencies', () => {
    const three: StopCluster = {
      ...cluster,
      memberStopIds: [1, 2, 3],
      agencyIds: [10, 20, 30],
    }
    // Stops 1 and 2 are adjacent in time; stop 3 is far off and must be pruned.
    const dep = new Map<number, number[]>([
      [1, [8 * 3600]],
      [2, [8 * 3600 + 300]],
      [3, [20 * 3600]],
    ])
    const out = applyClusterTransferTime([three], 15, dep, meta)
    expect(out).toHaveLength(1)
    expect(out[0]?.memberStopIds).toEqual([1, 2])
    expect(out[0]?.agencyIds).toEqual([10, 20])
  })

  it('drops a cluster when a member has no departures at all', () => {
    const dep = new Map<number, number[]>([
      [1, [8 * 3600]],
      // stop 2 has no departures
    ])
    const out = applyClusterTransferTime([cluster], 15, dep, meta)
    expect(out).toHaveLength(0)
  })
})

describe('stopClusterCsv', () => {
  function makeStop (id: number, name: string): Stop {
    return {
      id,
      stop_id: `S${id}`,
      stop_name: name,
      route_stops: [{ route_id: id * 10, agency_id: id }],
    } as unknown as Stop
  }

  function makeRoute (stopId: number, agency: string): RouteGql {
    return {
      id: stopId * 10,
      route_id: agency,
      route_type: 3,
      route_short_name: agency,
      route_long_name: '',
      agency: { id: stopId, agency_id: agency, agency_name: agency },
    } as unknown as RouteGql
  }

  it('flattens a cluster into a report row with agency/stop/route counts', () => {
    const cluster: StopCluster = {
      id: 'cluster:1',
      anchorStopId: 1,
      memberStopIds: [1, 2],
      agencyIds: [10, 20],
      routeIds: [10, 20],
      maxDistanceMeters: 200,
      name: 'First St',
    }
    const stopById = new Map<number, Stop>([
      [1, makeStop(1, 'First & Main')],
      [2, makeStop(2, 'First & Oak')],
    ])
    const routeLookup = routesById([makeRoute(1, 'TriMet'), makeRoute(2, 'C-Tran')])
    const rows = stopClusterCsv([cluster], stopById, routeLookup)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cluster).toBe('First St')
    expect(rows[0]?.agencies_count).toBe(2)
    expect(rows[0]?.stops_count).toBe(2)
    expect(rows[0]?.routes_count).toBe(2)
    expect(rows[0]?.agencies).toContain('TriMet')
    expect(rows[0]?.member_stops).toContain('First & Main (S1)')
  })

  it('uses the cluster\'s name and the place it is near', () => {
    const cluster: StopCluster = {
      id: 'cluster:1',
      anchorStopId: 1,
      memberStopIds: [1, 2],
      agencyIds: [10, 20],
      routeIds: [10, 20],
      maxDistanceMeters: DIST,
      name: 'Portland Curbside Bus Stop',
      nearName: 'Portland Union Station',
    }
    const rows = stopClusterCsv([cluster], new Map(), new Map())
    expect(rows[0]?.cluster).toBe('Portland Curbside Bus Stop')
    expect(rows[0]?.near).toBe('Portland Union Station')
  })
})

// Against the fixture transitland-server (docker/docker-compose.services.yaml):
// the cluster query's stop names and feeds, and the "near" lookup, as the
// server answers them. Downtown Portland, where TriMet and C-TRAN share stops
// on the transit mall.
describe('runStopClustersPhase (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )

  // The fixture's feed versions, as the fixture build loads them, so a
  // rebuilt fixture does not leave this test behind.
  const fixtureVersions = new Map(readFileSync(join(__dirname, '../../../testdata/gtfs/fvs.txt'), 'utf8')
    .split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(parts => parts.length === 2)
    .map(([feed, sha1]) => [feed!, sha1!]))

  it('names every cluster and centers it on one of its own stops', async () => {
    const clusters = await runStopClustersPhase({
      feedVersions: ['f-c20-trimet', 'f-c20g-c~tran'].map(feedOnestopId => ({
        feedOnestopId,
        feedVersionSha1: fixtureVersions.get(feedOnestopId)!,
      })),
      bbox: parseBbox('-122.69075,45.51358,-122.66809,45.53306'),
      geoDatasetName: 'tiger2021',
      maxDistanceMeters: 100,
    }, client, async () => {})
    expect(clusters.length).toBeGreaterThan(0)
    for (const c of clusters) {
      expect(c.name, c.id).toBeTruthy()
      expect(c.memberStopIds, c.id).toContain(c.anchorStopId)
      if (c.nearName !== undefined) {
        expect(c.nearName).not.toBe(c.name)
      }
    }
    // Where both agencies name the stop alike, the cluster takes that name.
    expect(clusters.map(c => c.name)).toContain('NW Everett & 5th')
  })
})
