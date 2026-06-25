// Debounced stop-cluster refetch on cluster-distance change: recomputes only the
// proximity clusters (server-side) into the existing receiver, leaving the rest of
// the scenario untouched. The transfer-time prune is client-side and needs no
// refetch. Streaming/abort/debounce machinery lives in useStreamingRefetch.

import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import type { FeedVersionRef, StopClusterFetchConfig } from '~~/src/scenario'

// scenarioReceiver is created by useScenarioRun and shared so refetched
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
