// The main scenario run lifecycle: streams a scenario from /api/scenario (or a
// canned example JSON) into a ScenarioDataReceiver and derives the filtered
// result whenever the raw data or filters change. Stream consumption and
// progress state live in useScenarioStream; this owns the receiver (shared
// with the buffer/cluster/aggregate refetch composables) and the data-graph
// wiring. Receives the data and config refs from the container, which owns the
// scenario data graph.

import { shallowRef, ref, watch, markRaw, type Ref, type ShallowRef } from 'vue'
import { useScenarioStream, type UseScenarioStreamReturn } from './useScenarioStream'
import {
  ScenarioDataReceiver,
  applyScenarioResultFilter,
  hasSearchArea,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioFilter,
  type ScenarioFilterResult,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'
import type { RequestFailure } from '~~/src/core'

interface UseScenarioRunDeps {
  // Owned by the container (the central data graph); written here as the stream
  // accumulates and as filters change.
  scenarioData: Ref<ScenarioData | undefined>
  scenarioFilterResult: Ref<ScenarioFilterResult | undefined>
  // Read-only inputs to the request body and the result filter.
  scenarioConfig: Ref<ScenarioConfig>
  scenarioFilter: Ref<ScenarioFilter>
}

export interface UseScenarioRunReturn {
  // Live accumulator, shared with the refetch composables so incremental
  // recomputes land in the same data. Reassigned on each fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<Error | undefined>
  // Requests that failed after all retries. Non-fatal — the run finishes — so
  // this is what tells the user the results are incomplete.
  requestErrors: Ref<RequestFailure[]>
  // Weighted progress-bar state shared with the loading modal and refetches.
  scenarioPhasePlan: Ref<ScenarioPhaseName[] | undefined>
  scenarioPhaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  // Ref-counts concurrent refetches so the modal closes only when the last settles.
  refetchInFlight: Ref<number>
  stopDepartureCount: Ref<number>
  // Streams a scenario. Returns false when validation declined to run.
  fetchScenario: () => Promise<boolean>
  // The shared modal/toast lifecycle around fetchScenario; see useScenarioStream.
  runQuery: UseScenarioStreamReturn['runQuery']
}

export function useScenarioRun (deps: UseScenarioRunDeps): UseScenarioRunReturn {
  const stream = useScenarioStream()
  const refetchInFlight = ref(0)
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()

  const fetchScenario = async (): Promise<boolean> => {
    const config = deps.scenarioConfig.value
    if (!hasSearchArea(config)) {
      return false
    }

    // Create receiver to accumulate scenario data
    const receiver = new ScenarioDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        stream.foldProgress(progress)

        // Apply filters to partial data and emit (without schedule-dependent features)
        // Skip if no route/stop/flex data in this progress update
        const hasRoutes = (progress.partialData?.routes?.length || 0) > 0
        const hasStops = (progress.partialData?.stops?.length || 0) > 0
        const hasFlexAreas = (progress.partialData?.flexAreas?.length || 0) > 0
        if (!hasRoutes && !hasStops && !hasFlexAreas) {
          return
        }
        deps.scenarioData.value = markRaw(receiver.getCurrentData())
      },
      onComplete: () => {
        // Get final accumulated data and apply filters
        stream.loadingProgress.value = undefined
        deps.scenarioData.value = markRaw(receiver.getCurrentData())
      },
      onError: (err: any) => {
        stream.error.value = err
      }
    })
    scenarioReceiver.value = receiver

    await stream.run(receiver, '/api/scenario', config)
    return true
  }

  // Apply filters and emit results when data or filters change
  watch(() => [
    deps.scenarioData.value,
    deps.scenarioFilter.value,
  ], () => {
    if (!deps.scenarioData.value) {
      return
    }
    deps.scenarioFilterResult.value = markRaw(
      applyScenarioResultFilter(deps.scenarioData.value, deps.scenarioConfig.value, deps.scenarioFilter.value),
    )
  })

  return {
    scenarioReceiver,
    loadingProgress: stream.loadingProgress,
    showLoadingModal: stream.showLoadingModal,
    error: stream.error,
    requestErrors: stream.requestErrors,
    scenarioPhasePlan: stream.phasePlan,
    scenarioPhaseFractions: stream.phaseFractions,
    refetchInFlight,
    stopDepartureCount: stream.stopDepartureCount,
    fetchScenario,
    runQuery: stream.runQuery,
  }
}
