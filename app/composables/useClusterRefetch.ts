// Debounced stop-cluster refetch (#330) on cluster-distance change. Recomputes
// only the proximity clusters (server-side, PostGIS) and streams them into the
// existing ScenarioDataReceiver so the rest of the scenario stays untouched.
// The max-transfer-time prune is applied client-side and needs no refetch.

import { markRaw, watch, onScopeDispose, type Ref, type ShallowRef } from 'vue'
import { useScenarioInputs } from './useScenarioInputs'
import {
  ScenarioStreamReceiver,
  type FeedVersionRef,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
  type StopClusterFetchConfig,
} from '~~/src/scenario'

interface UseClusterRefetchDeps {
  // Shared with the main fetch path (created by useBufferRefetch) so refetched
  // clusters land in the same accumulator.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  scenarioData: Ref<ScenarioData | undefined>
  // ComputedRef satisfies Ref for read access; the refetch only reads.
  scenarioConfig: Ref<ScenarioConfig>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<any>
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
}

// Without debounce, typing into the distance field fires a request per keystroke.
const DEBOUNCE_MS = 500

export function useClusterRefetch (deps: UseClusterRefetchDeps): void {
  let abort: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const { clusterDistance } = useScenarioInputs()

  async function refetch (): Promise<void> {
    const receiver = deps.scenarioReceiver.value
    const data = deps.scenarioData.value
    if (!receiver || !data) {
      return
    }
    abort?.abort()
    const localAbort = new AbortController()
    abort = localAbort

    // Disabling clustering (distance 0) clears immediately — no server call.
    if (!(clusterDistance.value > 0)) {
      receiver.clearStopClusters()
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
      return
    }

    // Note: don't clear the existing clusters here. Clearing would make
    // stopClusters momentarily empty, which bounces the user off the "Stop
    // Clusters" report tab (report.vue watches hasClusterData) on every retune.
    // processStream replaces the cluster set wholesale when the new run streams
    // in; we only clear on error (below) so a failed recompute doesn't strand
    // stale hubs on the map.
    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: 'Recomputing stop clusters...',
    }
    deps.phasePlan.value = ['stop-clusters']
    deps.phaseFractions.value = {}

    const feedVersions: FeedVersionRef[] = data.feedVersions.map(fv => ({
      feedOnestopId: fv.feed.onestop_id,
      feedVersionSha1: fv.sha1,
    }))
    const body: StopClusterFetchConfig = {
      feedVersions,
      bbox: deps.scenarioConfig.value.bbox,
      geographyIds: deps.scenarioConfig.value.geographyIds,
      geoDatasetName: deps.scenarioConfig.value.geoDatasetName,
      maxDistanceMeters: clusterDistance.value,
      stopLimit: deps.scenarioConfig.value.stopLimit,
    }

    try {
      const response = await fetch('/api/stop-clusters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: localAbort.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from /api/stop-clusters`)
      }
      if (!response.body) {
        throw new Error('No response body from /api/stop-clusters')
      }
      const streamer = new ScenarioStreamReceiver()
      const { success } = await streamer.processStream(response.body, receiver)
      if (!success) {
        throw new Error('Stop cluster refetch stream ended unexpectedly')
      }
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
    } catch (err: any) {
      // Superseded by a newer refetch (whose abort() fired this controller) or
      // the scope was disposed. The abort surfaces as a fetch AbortError if it
      // lands before the response resolves, but as a failed stream drain ('stream
      // ended unexpectedly') if it lands mid-stream — so key off the signal, not
      // the error name. A stale run must not touch shared state, else it clears
      // the newer run's clusters and bounces the user off the Stop Clusters tab.
      if (localAbort.signal.aborted) {
        return
      }
      // Genuine failure: drop the now-stale clusters so the map/report don't
      // keep showing hubs computed at the previous distance.
      receiver.clearStopClusters()
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
      deps.error.value = err
    } finally {
      if (abort === localAbort) {
        abort = undefined
        deps.showLoadingModal.value = false
        deps.loadingProgress.value = undefined
      }
    }
  }

  // Initial query reads the distance via `scenarioConfig` directly; this watch
  // only kicks in once a scenario is loaded.
  watch(clusterDistance, () => {
    if (!deps.scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      timer = undefined
      refetch()
    }, DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    if (timer) { clearTimeout(timer) }
    abort?.abort()
  })
}
