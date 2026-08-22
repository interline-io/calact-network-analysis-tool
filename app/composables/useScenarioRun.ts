// The main scenario run lifecycle: streams a scenario from /api/scenario into
// a ScenarioDataReceiver and derives the filtered result whenever the raw data
// or filters change. Stream consumption and progress state live in
// useScenarioStream; this owns the receiver (shared with the
// buffer/cluster/aggregate refetch composables) and the data-graph wiring.
// Receives the data and config refs from the container, which owns the
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
  type ScenarioProgress,
} from '~~/src/scenario'

interface UseScenarioRunDeps {
  // Owned by the container (the central data graph); written here as the stream
  // accumulates and as filters change.
  scenarioData: Ref<ScenarioData | undefined>
  scenarioFilterResult: Ref<ScenarioFilterResult | undefined>
  // Read-only inputs to the request body and the result filter.
  scenarioConfig: Ref<ScenarioConfig>
  scenarioFilter: Ref<ScenarioFilter>
}

// The stream state passes through under its own names; renames happen at the
// consumer's destructure, as the WSDOT components already do.
export interface UseScenarioRunReturn extends Pick<UseScenarioStreamReturn,
  'loadingProgress' | 'showLoadingModal' | 'error' | 'requestErrors'
  | 'phasePlan' | 'phaseFractions' | 'stopDepartureCount'> {
  // Live accumulator, shared with the refetch composables so incremental
  // recomputes land in the same data. Reassigned on each fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  // Ref-counts concurrent refetches so the modal closes only when the last settles.
  refetchInFlight: Ref<number>
  // Non-zero while a run is streaming. The refetch composables hold off while
  // it is, so their writes cannot interleave with the run's own phases.
  runInFlight: Ref<number>
  // Streams a scenario inside the shared modal/toast lifecycle.
  runQuery: (successToast: string) => Promise<void>
}

export function useScenarioRun (deps: UseScenarioRunDeps): UseScenarioRunReturn {
  const stream = useScenarioStream()
  const refetchInFlight = ref(0)
  const runInFlight = ref(0)
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

    runInFlight.value++
    try {
      await stream.run(receiver, '/api/scenario', config)
    } finally {
      runInFlight.value = Math.max(0, runInFlight.value - 1)
    }
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
    phasePlan: stream.phasePlan,
    phaseFractions: stream.phaseFractions,
    refetchInFlight,
    runInFlight,
    stopDepartureCount: stream.stopDepartureCount,
    runQuery: successToast => stream.runQuery(fetchScenario, successToast),
  }
}
