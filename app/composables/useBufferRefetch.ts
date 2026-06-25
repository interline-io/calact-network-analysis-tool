// Debounced buffer-only refetch on radius/layer change. Streams the
// result into the existing ScenarioDataReceiver so non-buffer state (stops,
// routes, departures, …) stays untouched.
//
// The streaming/abort/debounce machinery lives in useStreamingRefetch; this only
// supplies the buffer-specific bits (what to watch, the body, how to clear). The
// shared ScenarioDataReceiver is owned by useScenarioRun and passed in via deps.

import { useScenarioInputs } from './useScenarioInputs'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import { SCENARIO_DEFAULTS } from '~~/src/core'
import type { BufferFetchConfig } from '~~/src/scenario'

// scenarioReceiver is created by useScenarioRun and shared so refetched buffer
// geographies land in the same accumulator as the main scenario fetch.
export type UseBufferRefetchDeps = StreamingRefetchDeps

export function useBufferRefetch (deps: UseBufferRefetchDeps): void {
  const { stopBufferRadius, stopBufferLayer, geoDatasetName } = useScenarioInputs()

  useStreamingRefetch(deps, {
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
  })
}
