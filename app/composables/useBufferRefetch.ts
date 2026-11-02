// Debounced buffer-only refetch on radius/layer change. Streams the
// result into the existing ScenarioDataReceiver so non-buffer state (stops,
// routes, departures, …) stays untouched.
//
// The streaming/abort/debounce machinery lives in useStreamingRefetch; this only
// supplies the buffer-specific bits (what to watch, the body, how to clear). The
// shared ScenarioDataReceiver is owned by useScenarioRun and passed in via deps.

import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import { STOP_BUFFER_DEFAULT_LAYER } from '~~/src/core'
import { phaseEnabled, type BufferFetchConfig } from '~~/src/scenario'

// scenarioReceiver is created by useScenarioRun and shared so refetched buffer
// geographies land in the same accumulator as the main scenario fetch.
export type UseBufferRefetchDeps = StreamingRefetchDeps

export function useBufferRefetch (deps: UseBufferRefetchDeps): void {
  useStreamingRefetch(deps, {
    watchSources: [
      () => deps.scenarioConfig.value.stopBufferRadius,
      () => deps.scenarioConfig.value.stopBufferLayer,
    ],
    endpoint: 'buffer-geographies',
    loadingMessage: 'Recomputing buffer demographics...',
    clearBeforeFetch: true,
    clearStale: receiver => receiver.clearBufferGeographies(),
    plan: (data, config) => {
      const radius = config.stopBufferRadius ?? 0
      // Disabling buffers (radius 0) just clears the slice — no server call.
      if (!(radius > 0)) {
        return 'clear'
      }
      // The phase's own enablement: a fetch that excluded census or
      // fixed-route data has nothing to recompute.
      if (!phaseEnabled('buffers', config)) {
        return 'skip'
      }
      const agencyIds = [...new Set(
        data.routes.map(r => r.agency?.id).filter((id): id is number => id != null),
      )]
      const body: BufferFetchConfig = {
        radius,
        // Defaulted as in the scenario run.
        layer: config.stopBufferLayer || STOP_BUFFER_DEFAULT_LAYER,
        geoDatasetName: config.geoDatasetName,
        // The predicate above guarantees this is set.
        tableDatasetName: config.tableDatasetName!,
        stopIds: data.stops.map(s => s.id),
        routeIds: data.routes.map(r => r.id),
        agencyIds,
      }
      return body
    },
  })
}
