// Debounced buffer-only refetch (#315). When the user changes the stop
// statistical radius or buffer layer, this composable POSTs the current
// scenario's entity IDs to `/api/buffer-geographies`, streams the result
// back into the existing ScenarioDataReceiver (so non-buffer state is
// preserved), and drives the loading modal.
//
// Pulled out of tne.vue to keep the page file focused on top-level
// composition rather than the buffer-refetch state machine.

import { shallowRef, watch, onScopeDispose, type Ref } from 'vue'
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

// Debounce window for radius/layer changes — slider drags would otherwise
// fire one request per step.
const DEBOUNCE_MS = 500

export function useBufferRefetch (deps: UseBufferRefetchDeps) {
  // Held across calls so the buffer-only refetch can merge new geographies
  // into the same accumulator the main scenario fetch populated.
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()

  // AbortController for the in-flight refetch. New radius/layer changes
  // abort the previous request before issuing a new one.
  let abort: AbortController | undefined
  // Debounce timer for slider drags.
  let timer: ReturnType<typeof setTimeout> | undefined

  const { stopBufferRadius, stopBufferLayer, geoDatasetName } = useScenarioInputs()

  async function refetch (): Promise<void> {
    const receiver = scenarioReceiver.value
    const data = deps.scenarioData.value
    if (!receiver || !data) {
      return
    }
    abort?.abort()
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

  // Debounce radius/layer commits so a slider drag doesn't fire a request
  // per step. Only triggers when a scenario has already been loaded —
  // initial query reads the live values via `scenarioConfig` directly.
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
