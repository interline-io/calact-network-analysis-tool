import { describe, it, expect } from 'vitest'
import {
  deriveStopClusters,
  applyClusterTransferTime,
  stopClusterCsv,
  type ClusterInputStop,
  type StopCluster,
  type StopClusterMeta,
} from './stop-clusters'
import type { Stop } from '~~/src/tl'

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
  function makeStop (id: number, name: string, agency: string, route: string): Stop {
    return {
      id,
      stop_id: `S${id}`,
      stop_name: name,
      route_stops: [
        { route: { id: id * 10, route_id: route, route_type: 3, route_short_name: route, route_long_name: '', agency: { id: 1, agency_id: agency, agency_name: agency } } },
      ],
    } as unknown as Stop
  }

  it('flattens a cluster into a report row with agency/stop/route counts', () => {
    const cluster: StopCluster = {
      id: 'cluster:1',
      anchorStopId: 1,
      memberStopIds: [1, 2],
      agencyIds: [10, 20],
      routeIds: [10, 20],
      maxDistanceMeters: 200,
    }
    const stopById = new Map<number, Stop>([
      [1, makeStop(1, 'First & Main', 'TriMet', '10')],
      [2, makeStop(2, 'First & Oak', 'C-Tran', '4')],
    ])
    const rows = stopClusterCsv([cluster], stopById)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.cluster).toBe('Cluster 1')
    expect(rows[0]?.agencies_count).toBe(2)
    expect(rows[0]?.stops_count).toBe(2)
    expect(rows[0]?.routes_count).toBe(2)
    expect(rows[0]?.agencies).toContain('TriMet')
    expect(rows[0]?.member_stops).toContain('First & Main (S1)')
  })
})
