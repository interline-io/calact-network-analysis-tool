// Debounced stop-cluster refetch (#330) on cluster-distance change. Recomputes
// only the proximity clusters (server-side, PostGIS) and streams them into the
// existing ScenarioDataReceiver so the rest of the scenario stays untouched.
// The max-transfer-time prune is applied client-side and needs no refetch.
//
// The streaming/abort/debounce machinery lives in useStreamingRefetch; this only
// supplies the cluster-specific bits (what to watch, the body, how to clear).

import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import type { FeedVersionRef, StopClusterFetchConfig } from '~~/src/scenario'

// scenarioReceiver is created by useBufferRefetch and shared so refetched
// clusters land in the same accumulator.
export type UseClusterRefetchDeps = StreamingRefetchDeps

export function useClusterRefetch (deps: UseClusterRefetchDeps): void {
  const { clusterDistance } = useScenarioInputs()

  useStreamingRefetch(deps, {
    watchSources: [clusterDistance],
    endpoint: '/api/stop-clusters',
    phase: 'stop-clusters',
    loadingMessage: 'Recomputing stop clusters...',
    // A failed recompute would otherwise strand hubs computed at the old distance.
    clearOnError: true,
    clearStale: receiver => receiver.clearStopClusters(),
    plan: (data, config) => {
      // Disabling clustering (distance 0) just clears the slice — no server call.
      if (!(clusterDistance.value > 0)) {
        return 'clear'
      }
      const feedVersions: FeedVersionRef[] = data.feedVersions.map(fv => ({
        feedOnestopId: fv.feed.onestop_id,
        feedVersionSha1: fv.sha1,
      }))
      const body: StopClusterFetchConfig = {
        feedVersions,
        bbox: config.bbox,
        geographyIds: config.geographyIds,
        geoDatasetName: config.geoDatasetName,
        maxDistanceMeters: clusterDistance.value,
        stopLimit: config.stopLimit,
      }
      return body
    },
  })
}
