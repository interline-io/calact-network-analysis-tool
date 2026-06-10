// Debounced buffer-only refetch (#315) on radius/layer change. Streams the
// result into the existing ScenarioDataReceiver so non-buffer state (stops,
// routes, departures, …) stays untouched.

import { markRaw, shallowRef, watch, onScopeDispose, type Ref, type ShallowRef } from 'vue'
import { useScenarioInputs } from './useScenarioInputs'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import {
  ScenarioStreamReceiver,
  type BufferFetchConfig,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioDataReceiver,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'

interface UseBufferRefetchDeps {
  scenarioData: Ref<ScenarioData | undefined>
  // ComputedRef satisfies Ref for read access; the refetch only reads.
  scenarioConfig: Ref<ScenarioConfig>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<any>
  // Weighted progress-bar state shared with the loading modal; the refetch
  // installs a single-phase plan so the bar tracks the buffer passes.
  phasePlan: Ref<ScenarioPhaseName[] | undefined>
  phaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
}

export interface UseBufferRefetchReturn {
  // Shared with the main fetch path so refetched buffer state lands in the
  // same accumulator. Parent assigns into this after each main scenario fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
}

// Without debounce a slider drag fires one request per step.
const DEBOUNCE_MS = 500

export function useBufferRefetch (deps: UseBufferRefetchDeps): UseBufferRefetchReturn {
  // Shared with the main fetch path so refetched buffer state lands in the
  // same accumulator.
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()

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
    // Census demographics were excluded at query time; don't fetch them post-hoc.
    if (deps.scenarioConfig.value.includeCensus === false) {
      return
    }
    abort?.abort()
    const localAbort = new AbortController()
    abort = localAbort

    receiver.clearBufferGeographies()
    deps.scenarioData.value = markRaw(receiver.getCurrentData())

    deps.showLoadingModal.value = true
    deps.loadingProgress.value = {
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: 'Recomputing buffer demographics...',
    }
    // The refetch streams through the same receiver as the main fetch, so
    // its 'buffers' phaseProgress events drive the bar under this plan.
    deps.phasePlan.value = ['buffers']
    deps.phaseFractions.value = {}

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
      deps.scenarioData.value = markRaw(receiver.getCurrentData())
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

  // Initial query reads radius/layer via `scenarioConfig` directly; this
  // watch only kicks in once a scenario is loaded.
  watch([stopBufferRadius, stopBufferLayer], () => {
    if (!scenarioReceiver.value || !deps.scenarioData.value) {
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

  return { scenarioReceiver }
}
