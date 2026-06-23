// Debounced buffer-only refetch on radius/layer change. Streams the
// result into the existing ScenarioDataReceiver so non-buffer state (stops,
// routes, departures, …) stays untouched.
//
// The streaming/abort/debounce machinery lives in useStreamingRefetch; this only
// supplies the buffer-specific bits (what to watch, the body, how to clear) and
// owns the shared ScenarioDataReceiver that the main fetch path reuses.

import { shallowRef, type Ref, type ShallowRef } from 'vue'
import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch } from './useStreamingRefetch'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import type {
  BufferFetchConfig,
  ScenarioConfig,
  ScenarioData,
  ScenarioDataReceiver,
  ScenarioPhaseName,
  ScenarioProgress,
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

export function useBufferRefetch (deps: UseBufferRefetchDeps): UseBufferRefetchReturn {
  // Shared with the main fetch path so refetched buffer state lands in the
  // same accumulator.
  const scenarioReceiver = shallowRef<ScenarioDataReceiver>()

  const { stopBufferRadius, stopBufferLayer, geoDatasetName } = useScenarioInputs()

  useStreamingRefetch(
    { ...deps, scenarioReceiver },
    {
      watchSources: [stopBufferRadius, stopBufferLayer],
      endpoint: '/api/buffer-geographies',
      phase: 'buffers',
      loadingMessage: 'Recomputing buffer demographics...',
      clearBeforeFetch: true,
      clearStale: receiver => receiver.clearBufferGeographies(),
      plan: (data, config) => {
        // Census demographics were excluded at query time; don't fetch them post-hoc.
        if (config.includeCensus === false) {
          return 'skip'
        }
        const agencyIds = [...new Set(
          data.routes.map(r => r.agency?.id).filter((id): id is number => id != null),
        )]
        const body: BufferFetchConfig = {
          radius: stopBufferRadius.value,
          layer: stopBufferLayer.value,
          geoDatasetName: geoDatasetName.value,
          tableDatasetName: config.tableDatasetName ?? SCENARIO_DEFAULTS.tableDatasetName,
          stopIds: data.stops.map(s => s.id),
          routeIds: data.routes.map(r => r.id),
          agencyIds,
        }
        return body
      },
    },
  )

  return { scenarioReceiver }
}
