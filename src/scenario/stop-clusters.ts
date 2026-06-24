/**
 * Stop Clustering for Key Transit Hubs
 *
 * Identifies clusters of nearby stops that could act as cross-agency transfer
 * hubs. The design (see docs/stop-clustering-plan.md) splits the work across
 * three pieces:
 *
 *   1. deriveStopClusters() — pure graph/assignment over proximity edges. Runs
 *      SERVER-SIDE in runStopClustersPhase(). Does NO geometry itself: the edges
 *      (from PostGIS Stop.nearby_stops) already encode "within max distance".
 *
 *   2. runStopClustersPhase() / fetchStopClusterInputs() — the server-side
 *      scenario phase: paginate the scenario stops with their nearby_stops
 *      neighbors, then run deriveStopClusters and emit the result.
 *
 *   3. applyClusterTransferTime() — runs CLIENT-SIDE in applyScenarioResultFilter,
 *      pruning members that lack a temporally-adjacent partner using the
 *      already-loaded departure times. Pure time arithmetic.
 */

import {
  convertBbox,
  routeTypeNames,
  TaskQueue,
  type Bbox,
  type GraphQLClient,
} from '~~/src/core'
import { stopClusterQuery, type Stop, type StopClusterStopResponse } from '~~/src/tl'
import {
  PHASE_MAX_CONCURRENT_REQUESTS,
  phaseDone,
  type FeedVersionRef,
  type PhaseEmit,
  type PhaseOpts,
} from './phases/common'
import type { ScenarioProgress } from './scenario'

/** Minimal per-stop input for clustering, decoupled from GraphQL types. */
export interface ClusterInputStop {
  id: number
  /** Distinct agency ids serving this stop (derived from route_stops). */
  agencyIds: number[]
  /** Distinct route ids serving this stop (derived from route_stops). */
  routeIds: number[]
  /** Stop ids within the max distance, from PostGIS nearby_stops (server-side). */
  neighborIds: number[]
}

/** Per-stop agency/route metadata, used when re-deriving a pruned cluster. */
export interface StopClusterMeta {
  agencyIds: number[]
  routeIds: number[]
}

/** A computed cross-agency transfer-hub cluster. Lean + JSON-serializable. */
export interface StopCluster {
  /** Stable id, namespaced to avoid colliding with stop ids on the map. */
  id: string
  /** The stop the cluster ball is centered on (the map circle centers here). */
  anchorStopId: number
  /** Member stop ids (one representative stop per agency; >= 2). */
  memberStopIds: number[]
  /** Distinct agency ids present across member stops (>= 2). */
  agencyIds: number[]
  /** Distinct route ids present across member stops. */
  routeIds: number[]
  /** The max distance (meters) used — drives the map circle radius. */
  maxDistanceMeters: number
}

/** A cluster needs at least this many member stops (a hub is multi-stop). */
const MIN_CLUSTER_MEMBERS = 2

/**
 * Choose representative stops covering the ball's agencies. Stops are processed
 * richest first (more routes, then lowest id) for deterministic, stable results,
 * and a stop is kept only if it adds at least one agency not yet covered. A
 * chosen stop then claims ALL of its agencies, so a later stop is admitted only
 * when it brings a genuinely new agency — though it may also serve agencies an
 * earlier member already covered (one multi-agency stop can cover several).
 */
function selectClusterMembers (
  ballStopIds: number[],
  byId: Map<number, ClusterInputStop>,
): number[] {
  const ordered = ballStopIds
    .map(id => byId.get(id))
    .filter((s): s is ClusterInputStop => !!s)
    .sort((a, b) => (b.routeIds.length - a.routeIds.length) || (a.id - b.id))
  const coveredAgencies = new Set<number>()
  const chosen: number[] = []
  for (const stop of ordered) {
    const newAgency = stop.agencyIds.find(a => !coveredAgencies.has(a))
    if (newAgency === undefined) {
      continue
    }
    chosen.push(stop.id)
    for (const a of stop.agencyIds) {
      coveredAgencies.add(a)
    }
  }
  return chosen
}

/** Build a StopCluster from a chosen member set, unioning agency/route ids. */
function buildCluster (
  anchor: number,
  memberStopIds: number[],
  byId: Map<number, ClusterInputStop>,
  maxDistanceMeters: number,
): StopCluster {
  const agencyIds = new Set<number>()
  const routeIds = new Set<number>()
  for (const id of memberStopIds) {
    const stop = byId.get(id)
    if (!stop) {
      continue
    }
    for (const a of stop.agencyIds) {
      agencyIds.add(a)
    }
    for (const r of stop.routeIds) {
      routeIds.add(r)
    }
  }
  return {
    id: `cluster:${anchor}`,
    anchorStopId: anchor,
    memberStopIds: [...memberStopIds].sort((a, b) => a - b),
    agencyIds: [...agencyIds].sort((a, b) => a - b),
    routeIds: [...routeIds].sort((a, b) => a - b),
    maxDistanceMeters,
  }
}

/**
 * Group nearby stops into cross-agency transfer-hub clusters.
 *
 * Each candidate cluster is an "anchor ball": a stop plus its in-distance
 * neighbors (so a circle of radius = maxDistanceMeters centered on the anchor
 * contains every member). Within a ball, one representative stop is chosen per
 * agency. Clusters are assigned greedily — repeatedly take the largest valid
 * candidate, emit it, remove its stops from the pool, and recompute — so the
 * result is disjoint (no stop in two clusters) and prefers larger hubs.
 *
 * @param stops - per-stop agency/route/neighbor data (neighbors from PostGIS)
 * @param maxDistanceMeters - the distance used, stamped on each cluster
 * @returns disjoint clusters, each with >= 2 member stops and >= 2 agencies
 */
export function deriveStopClusters (
  stops: ClusterInputStop[],
  maxDistanceMeters: number,
): StopCluster[] {
  const byId = new Map<number, ClusterInputStop>()
  for (const s of stops) {
    byId.set(s.id, s)
  }

  // Build undirected adjacency (nearby_stops should be symmetric, but don't
  // assume — link both directions and ignore dangling/self edges).
  const adj = new Map<number, Set<number>>()
  const link = (a: number, b: number): void => {
    if (a === b || !byId.has(a) || !byId.has(b)) {
      return
    }
    let set = adj.get(a)
    if (!set) {
      set = new Set<number>()
      adj.set(a, set)
    }
    set.add(b)
  }
  for (const s of stops) {
    for (const n of s.neighborIds) {
      link(s.id, n)
      link(n, s.id)
    }
  }

  const pool = new Set<number>(byId.keys())
  const clusters: StopCluster[] = []

  // Greedy maximal assignment. Recomputing the best candidate each round is
  // O(rounds * stops * degree); fine for the hundreds-to-low-thousands of stops
  // in a typical bbox. Revisit with spatial bucketing if it ever gets hot.
  for (;;) {
    let best: { anchor: number, members: number[] } | null = null
    for (const anchor of pool) {
      const neighbors = adj.get(anchor)
      const ball = [anchor]
      if (neighbors) {
        for (const id of neighbors) {
          if (pool.has(id)) {
            ball.push(id)
          }
        }
      }
      const members = selectClusterMembers(ball, byId)
      if (members.length < MIN_CLUSTER_MEMBERS) {
        continue
      }
      if (
        !best
        || members.length > best.members.length
        || (members.length === best.members.length && anchor < best.anchor)
      ) {
        best = { anchor, members }
      }
    }
    if (!best) {
      break
    }
    clusters.push(buildCluster(best.anchor, best.members, byId, maxDistanceMeters))
    for (const id of best.members) {
      pool.delete(id)
    }
  }
  return clusters
}

/** True if any value in sorted `a` is within `maxGap` of any value in sorted `b`. */
function anyWithin (a: number[], b: number[], maxGap: number): boolean {
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const av = a[i] as number
    const bv = b[j] as number
    const diff = av - bv
    if (Math.abs(diff) <= maxGap) {
      return true
    }
    if (diff < 0) {
      i++
    } else {
      j++
    }
  }
  return false
}

/**
 * Apply the "max transfer time" temporal filter to clusters (client-side).
 *
 * A member qualifies only if it has a departure within `maxTransferMinutes` of a
 * departure at another currently-kept member. Pruning iterates to a fixed point
 * so removing a member can cascade to members whose only partner it was. After
 * pruning, clusters with fewer than 2 members / 2 agencies are dropped, and the
 * surviving clusters' agency/route id sets are re-derived from the kept members.
 *
 * When `maxTransferMinutes` is falsy the clusters are returned unchanged.
 *
 * @param clusters - clusters from deriveStopClusters()
 * @param maxTransferMinutes - the temporal threshold (minutes); falsy = off
 * @param departureSecondsByStop - stop id -> all departure times (sec since midnight)
 * @param stopMeta - stop id -> agency/route ids (to re-derive surviving clusters)
 */
export function applyClusterTransferTime (
  clusters: StopCluster[],
  maxTransferMinutes: number | undefined,
  departureSecondsByStop: Map<number, number[]>,
  stopMeta: Map<number, StopClusterMeta>,
): StopCluster[] {
  if (!maxTransferMinutes || maxTransferMinutes <= 0) {
    return clusters
  }
  const maxGap = maxTransferMinutes * 60

  const sortedTimes = new Map<number, number[]>()
  const timesFor = (id: number): number[] => {
    let t = sortedTimes.get(id)
    if (!t) {
      t = [...(departureSecondsByStop.get(id) ?? [])].sort((a, b) => a - b)
      sortedTimes.set(id, t)
    }
    return t
  }

  const result: StopCluster[] = []
  for (const cluster of clusters) {
    const kept = new Set<number>(cluster.memberStopIds)
    let changed = true
    while (changed) {
      changed = false
      for (const m of [...kept]) {
        let hasPartner = false
        for (const o of kept) {
          if (o === m) {
            continue
          }
          if (anyWithin(timesFor(m), timesFor(o), maxGap)) {
            hasPartner = true
            break
          }
        }
        if (!hasPartner) {
          kept.delete(m)
          changed = true
        }
      }
    }
    if (kept.size < MIN_CLUSTER_MEMBERS) {
      continue
    }
    const memberStopIds = [...kept].sort((a, b) => a - b)
    const agencyIds = new Set<number>()
    const routeIds = new Set<number>()
    for (const id of memberStopIds) {
      const meta = stopMeta.get(id)
      if (!meta) {
        continue
      }
      for (const a of meta.agencyIds) {
        agencyIds.add(a)
      }
      for (const r of meta.routeIds) {
        routeIds.add(r)
      }
    }
    if (agencyIds.size < 2) {
      continue
    }
    result.push({
      ...cluster,
      memberStopIds,
      agencyIds: [...agencyIds].sort((a, b) => a - b),
      routeIds: [...routeIds].sort((a, b) => a - b),
    })
  }
  return result
}

// ============================================================================
// SERVER-SIDE PHASE — fetch proximity edges (PostGIS) and derive clusters
// ============================================================================

// Cap on neighbors returned per stop by nearby_stops. The radius is the real
// constraint on cluster membership; this is just a high safety bound so a
// pathologically dense area can't return an unbounded neighbor list per stop.
const NEARBY_STOPS_LIMIT = 1000

// Config for the clustering phase / standalone refetch. JSON-serializable so it
// crosses the BFF boundary (mirrors BufferFetchConfig).
export interface StopClusterFetchConfig {
  feedVersions: FeedVersionRef[]
  bbox?: Bbox
  geographyIds?: number[]
  geoDatasetName: string
  // The PostGIS nearby_stops radius (meters) — the cluster max distance.
  maxDistanceMeters: number
  // GraphQL page size; pagination continues until a short page.
  stopLimit?: number
}

interface StopClusterFetchTask {
  after: number
  feedOnestopId: string
  feedVersionSha1: string
}

// Map a raw GraphQL stop into the minimal ClusterInputStop the algorithm needs.
function toClusterInputStop (stop: StopClusterStopResponse): ClusterInputStop {
  const agencyIds = new Set<number>()
  const routeIds = new Set<number>()
  for (const rs of stop.route_stops || []) {
    const route = rs.route
    if (route?.id != null) {
      routeIds.add(route.id)
    }
    if (route?.agency?.id != null) {
      agencyIds.add(route.agency.id)
    }
  }
  return {
    id: stop.id,
    agencyIds: [...agencyIds],
    routeIds: [...routeIds],
    neighborIds: (stop.nearby_stops || []).map(n => n.id),
  }
}

// Paginate the scenario's stops (with their in-radius neighbors) and return the
// complete ClusterInputStop set. Mirrors runStopsPhase's pagination.
async function fetchStopClusterInputs (
  config: StopClusterFetchConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<ClusterInputStop[]> {
  const stopLimit = config.stopLimit ?? 1000
  const inputs: ClusterInputStop[] = []

  function progressEvent (): ScenarioProgress {
    const p = queue.getProgress()
    return {
      isLoading: true,
      currentStage: 'stop-clusters',
      phaseProgress: { phase: 'stop-clusters', completed: p.completed, total: p.total },
    }
  }

  async function fetchPage (task: StopClusterFetchTask): Promise<void> {
    const geoIds = config.geographyIds || []
    const b = geoIds.length > 0 ? null : convertBbox(config.bbox)
    const variables = {
      after: task.after,
      limit: stopLimit,
      radius: config.maxDistanceMeters,
      nearbyLimit: NEARBY_STOPS_LIMIT,
      where: {
        location_type: 0,
        feed_version_sha1: task.feedVersionSha1,
        location: {
          bbox: geoIds.length > 0 ? null : b,
          geography_ids: geoIds.length > 0 ? geoIds : null,
        },
      },
    }
    const response = await client.query<{ stops: StopClusterStopResponse[] }>(stopClusterQuery, variables)
    const stops = response.data?.stops || []
    for (const stop of stops) {
      inputs.push(toClusterInputStop(stop))
    }
    const lastStopId = stops[stops.length - 1]?.id
    if (stops.length >= stopLimit && lastStopId !== undefined) {
      queue.enqueueOne({
        after: lastStopId,
        feedOnestopId: task.feedOnestopId,
        feedVersionSha1: task.feedVersionSha1,
      })
    }
  }

  const queue: TaskQueue<StopClusterFetchTask> = new TaskQueue<StopClusterFetchTask>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    task => fetchPage(task),
    {
      onProgress: () => { emit(progressEvent()) },
      onError: error => opts.onError?.(error),
    },
  )

  for (const fv of config.feedVersions) {
    queue.enqueueOne({
      after: 0,
      feedOnestopId: fv.feedOnestopId,
      feedVersionSha1: fv.feedVersionSha1,
    })
  }
  await queue.run()
  return inputs
}

/**
 * The `stop-clusters` scenario phase: fetch proximity edges from PostGIS, derive
 * clusters, and emit them. Pure over its inputs; callers wrap `emit` with either
 * a stream sender (main scenario / standalone endpoint) or an accumulator.
 */
export async function runStopClustersPhase (
  config: StopClusterFetchConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<StopCluster[]> {
  const inputs = await fetchStopClusterInputs(config, client, emit, opts)
  const clusters = deriveStopClusters(inputs, config.maxDistanceMeters)
  emit({
    isLoading: true,
    currentStage: 'stop-clusters',
    partialData: { stopClusters: clusters },
    phaseProgress: phaseDone('stop-clusters'),
  })
  return clusters
}

// ============================================================================
// REPORT — one flat row per cluster for the "Stop Clusters" aggregation tab
// ============================================================================

export interface StopClusterCsv {
  cluster: string
  agencies_count: number
  agencies: string
  stops_count: number
  routes_count: number
  routes_modes: string
  member_stops: string
  [key: string]: string | number
}

/**
 * Flatten clusters into report rows, resolving member stop ids to names and
 * deriving agency/route/mode sets from the already-loaded stop data.
 */
export function stopClusterCsv (
  clusters: StopCluster[],
  stopById: Map<number, Stop>,
): StopClusterCsv[] {
  return clusters.map((cluster, idx): StopClusterCsv => {
    const agencies = new Set<string>()
    const modes = new Set<number>()
    const routeIds = new Set<number>()
    const memberStops: string[] = []
    for (const sid of cluster.memberStopIds) {
      const stop = stopById.get(sid)
      if (!stop) {
        continue
      }
      memberStops.push(stop.stop_name ? `${stop.stop_name} (${stop.stop_id})` : stop.stop_id)
      for (const rs of stop.route_stops || []) {
        if (rs.route.agency?.agency_name) {
          agencies.add(rs.route.agency.agency_name)
        }
        if (rs.route.id != null) {
          routeIds.add(rs.route.id)
        }
        modes.add(rs.route.route_type)
      }
    }
    return {
      cluster: `Cluster ${idx + 1}`,
      agencies_count: agencies.size,
      agencies: [...agencies].join(', '),
      stops_count: cluster.memberStopIds.length,
      routes_count: routeIds.size,
      routes_modes: [...modes].map(m => routeTypeNames.get(m) || 'Unknown').join(', '),
      member_stops: memberStops.join('; '),
    }
  })
}
