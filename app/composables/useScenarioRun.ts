// The main scenario run lifecycle: streams a scenario from /api/scenario (or a
// canned example JSON) into a ScenarioDataReceiver, tracks loading/progress
// state for the modal, and derives the filtered result whenever the raw data or
// filters change. Owns the run/loading state (and the shared receiver that the
// buffer/cluster/aggregate refetch composables reuse); receives the data and
// config refs from the container, which owns the scenario data graph.

import { ref, shallowRef, watch, markRaw, type Ref, type ShallowRef } from 'vue'
import { useToastNotification } from './useToastNotification'
import {
  ScenarioStreamReceiver,
  ScenarioDataReceiver,
  applyScenarioResultFilter,
  type ScenarioConfig,
  type ScenarioData,
  type ScenarioFilter,
  type ScenarioFilterResult,
  type ScenarioPhaseName,
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

export interface UseScenarioRunReturn {
  // Live accumulator, shared with the refetch composables so incremental
  // recomputes land in the same data. Reassigned on each fetch.
  scenarioReceiver: ShallowRef<ScenarioDataReceiver | undefined>
  loadingProgress: Ref<ScenarioProgress | undefined>
  showLoadingModal: Ref<boolean>
  error: Ref<Error | string | undefined>
  // Weighted progress-bar state shared with the loading modal and refetches.
  scenarioPhasePlan: Ref<ScenarioPhaseName[] | undefined>
  scenarioPhaseFractions: Ref<Partial<Record<ScenarioPhaseName, number>>>
  // Ref-counts concurrent refetches so the modal closes only when the last settles.
  refetchInFlight: Ref<number>
  stopDepartureCount: Ref<number>
  // Streams a scenario; pass an example name to load canned JSON, '' for a live query.
  fetchScenario: (loadExample: string) => Promise<void>
}

export function useScenarioRun (deps: UseScenarioRunDeps): UseScenarioRunReturn {
  const loadingProgress = ref<ScenarioProgress>()
  const stopDepartureCount = ref<number>(0)
  // Weighted progress-bar state, accumulated inside the receiver callback so no
  // events are missed (template-level watchers only sample the latest).
  const scenarioPhasePlan = ref<ScenarioPhaseName[] | undefined>()
  const scenarioPhaseFractions = ref<Partial<Record<ScenarioPhaseName, number>>>({})
  const showLoadingModal = ref(false)
  const refetchInFlight = ref(0)
  const error = ref(undefined as Error | string | undefined)
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()

  const fetchScenario = async (loadExample: string): Promise<void> => {
    const config = deps.scenarioConfig.value
    if (!loadExample && !config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      return // Need either bbox or geography IDs, unless loading example
    }
    loadingProgress.value = undefined
    // Clear any error left by a prior run/refetch so a fresh run starts clean —
    // otherwise the success path (gated on !error) stays suppressed.
    error.value = undefined
    stopDepartureCount.value = 0
    scenarioPhasePlan.value = undefined
    scenarioPhaseFractions.value = {}

    // Create receiver to accumulate scenario data
    const receiver = new ScenarioDataReceiver({
      onProgress: (progress: ScenarioProgress) => {
        // Update progress for modal
        loadingProgress.value = progress
        stopDepartureCount.value += progress.partialData?.stopDepartures?.length || 0

        // Weighted progress bar: plan announcement + per-phase fractions
        // (clamped max-so-far; stop pagination grows its denominator mid-phase)
        if (progress.phasePlan) {
          scenarioPhasePlan.value = progress.phasePlan
          scenarioPhaseFractions.value = {}
        }
        const pp = progress.phaseProgress
        if (pp) {
          const fraction = pp.total > 0 ? Math.min(pp.completed / pp.total, 1) : 0
          if (fraction > (scenarioPhaseFractions.value[pp.phase] ?? 0)) {
            scenarioPhaseFractions.value = { ...scenarioPhaseFractions.value, [pp.phase]: fraction }
          }
        }

        if (progress.warnings && progress.warnings.length > 0) {
          for (const msg of progress.warnings) {
            useToastNotification().showToast(msg)
          }
        }

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
        loadingProgress.value = undefined
        deps.scenarioData.value = markRaw(receiver.getCurrentData())
      },
      onError: (err: any) => {
        error.value = err
      }
    })
    scenarioReceiver.value = receiver

    let response: Response

    if (loadExample) {
      // Load example data from public JSON file
      response = await fetch(`/examples/${loadExample}.json`)
    } else {
      // Make request to streaming scenario endpoint
      response = await fetch('/api/scenario', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      })
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('No response body received')
    }

    // Process the streaming response
    const streamer = new ScenarioStreamReceiver()
    const { success } = await streamer.processStream(response.body, receiver)
    if (!success) {
      error.value = new Error('Stream ended unexpectedly. The server may have run out of memory. Try a smaller region.')
    }
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
    loadingProgress,
    showLoadingModal,
    error,
    scenarioPhasePlan,
    scenarioPhaseFractions,
    refetchInFlight,
    stopDepartureCount,
    fetchScenario,
  }
}
