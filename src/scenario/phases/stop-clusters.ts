// Phase: cross-agency transfer-hub clusters. Paginates the scenario's stops
// with their PostGIS `nearby_stops` neighbors, then derives clusters from those
// proximity edges. The clustering algorithm itself lives in
// `src/scenario/stop-clusters.ts` alongside the client-side transfer-time prune.

import {
  convertBbox,
  TaskQueue,
  type Bbox,
  type GraphQLClient,
} from '~~/src/core'
import { stopClusterQuery, type StopClusterStopResponse } from '~~/src/tl'
import {
  deriveStopClusters,
  type ClusterInputStop,
  type StopCluster,
} from '../stop-clusters'
import type { ScenarioProgress } from '../scenario'
import {
  PHASE_MAX_CONCURRENT_REQUESTS,
  phaseDone,
  type FeedVersionRef,
  type PhaseEmit,
  type PhaseOpts,
} from './common'

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
