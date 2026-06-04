// Debounced buffer-only refetch (#315) on radius/layer change. Streams the
// result into the existing ScenarioDataReceiver so non-buffer state (stops,
// routes, departures, …) stays untouched.

import { shallowRef, watch, onScopeDispose, type Ref, type ShallowRef } from 'vue'
import { useScenarioInputs } from './useScenarioInputs'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import {
  ScenarioStreamReceiver,
  type BufferFetchConfig,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioProgress,
} from '~~/src/scenario'

interface UseBufferRefetchDeps {
  scenarioData: Ref<ScenarioData | undefined>
  // ComputedRef satisfies Ref for read access; the refetch only reads.
  scenarioConfig: Ref<ScenarioConfig>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<any>
}

export interface UseBufferRefetchReturn {
  // Shared with the main fetch path so refetched buffer state lands in the
  // same accumulator. Parent assigns into this after each main scenario fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  // Whether buffer demographics were requested this session — true when the
  // scenario loaded with `includeStopBufferDemographics`, or after loadNow().
  // Gates the radius/layer auto-refetch watcher and the loading modal's
  // Demographics column. Parent resets it after each main scenario fetch.
  demographicsRequested: ShallowRef<boolean>
  // Explicit deferred load for the "Load stop buffer demographics" buttons.
  loadNow: () => Promise<void>
}

// Without debounce a slider drag fires one request per step.
const DEBOUNCE_MS = 500

export function useBufferRefetch (deps: UseBufferRefetchDeps): UseBufferRefetchReturn {
  // Shared with the main fetch path so refetched buffer state lands in the
  // same accumulator.
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()
  const demographicsRequested = shallowRef(false)

  // Aborted on the next radius/layer change before issuing the new request.
  let abort: AbortController | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  const { stopBufferRadius, stopBufferLayer, geoDatasetName } = useScenarioInputs()

  async function refetch (): Promise<void> {
    const receiver = scenarioReceiver.value
    const data = deps.scenarioData.value
    if (!receiver || !data) {
      return
    }
    abort?.abort()

    // Radius 0 means "feature off" — clear loaded demographics rather than
    // POSTing radius 0 (which /api/buffer-geographies rejects).
    if (stopBufferRadius.value <= 0) {
      receiver.clearBufferGeographies()
      deps.scenarioData.value = receiver.getCurrentData()
      return
    }

    const localAbort = new AbortController()
    abort = localAbort

    receiver.clearBufferGeographies()
    deps.scenarioData.value = receiver.getCurrentData()

    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: 'Recomputing buffer demographics...',
    }

    const agencyIds = [...new Set(
      data.routes.map(r => r.agency?.id).filter((id): id is number => id != null),
    )]
    const body: BufferFetchConfig = {
      radius: stopBufferRadius.value,
      layer: stopBufferLayer.value,
      geoDatasetName: geoDatasetName.value,
      tableDatasetName: deps.scenarioConfig.value.tableDatasetName ?? SCENARIO_DEFAULTS.tableDatasetName,
      stopIds: data.stops.map(s => s.id),
      routeIds: data.routes.map(r => r.id),
      agencyIds,
    }

    try {
      const response = await fetch('/api/buffer-geographies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: localAbort.signal,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from /api/buffer-geographies`)
      }
      if (!response.body) {
        throw new Error('No response body from /api/buffer-geographies')
      }
      const streamer = new ScenarioStreamReceiver()
      const { success } = await streamer.processStream(response.body, receiver)
      if (!success) {
        throw new Error('Buffer refetch stream ended unexpectedly')
      }
      deps.scenarioData.value = receiver.getCurrentData()
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return
      }
      deps.error.value = err
    } finally {
      if (abort === localAbort) {
        abort = undefined
        deps.showLoadingModal.value = false
        deps.loadingProgress.value = undefined
      }
    }
  }

  // Deferred load for the "Load stop buffer demographics" buttons. Once
  // called, the radius/layer watcher takes over for subsequent changes.
  async function loadNow (): Promise<void> {
    if (stopBufferRadius.value <= 0) {
      return
    }
    demographicsRequested.value = true
    await refetch()
  }

  // Initial query reads radius/layer via `scenarioConfig` directly; this
  // watch only kicks in once a scenario is loaded — and only after the user
  // has requested demographics (with the scenario or via loadNow()).
  watch([stopBufferRadius, stopBufferLayer], () => {
    if (!scenarioReceiver.value || !deps.scenarioData.value) {
      return
    }
    if (!demographicsRequested.value) {
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

  return { scenarioReceiver, demographicsRequested, loadNow }
}
