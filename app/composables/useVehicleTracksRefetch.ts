// Fetches the vehicle playback's tracks into the shared receiver while "Show
// vehicles" is on. Streaming/abort/debounce machinery lives in
// useStreamingRefetch.

import { format } from 'date-fns'
import { useScenarioDisplay } from './useScenarioDisplay'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import { getSelectedDateRange, type ScenarioConfig, type VehicleTracksPhaseConfig } from '~~/src/scenario'

export type UseVehicleTracksRefetchDeps = StreamingRefetchDeps

// The day the playback shows: the query's start date.
export function vehiclePlaybackDate (config: ScenarioConfig): Date | undefined {
  return getSelectedDateRange(config)[0]
}

export function useVehicleTracksRefetch (deps: UseVehicleTracksRefetchDeps): void {
  const { showVehicles } = useScenarioDisplay()

  useStreamingRefetch(deps, {
    // A run brings a fresh receiver without vehicles, so the playback fetches
    // its own once the run finishes.
    watchSources: [showVehicles, deps.scenarioReceiver],
    endpoint: 'scenario/vehicle-tracks',
    loadingMessage: 'Loading vehicle schedules...',
    // Tracks accumulate, so a refetch over tracks already loaded starts clean.
    // A failed fetch would otherwise leave some routes' vehicles and not others.
    clearBeforeFetch: () => !!deps.scenarioData.value?.vehicleTracks?.length,
    clearOnError: true,
    clearStale: receiver => receiver.clearVehicleTracks(),
    plan: (data, config) => {
      if (!showVehicles.value) {
        // Nothing to clear after a run, and clearing republishes the data,
        // which refilters the whole scenario.
        return data.vehicleTracks?.length ? 'clear' : 'skip'
      }
      const date = vehiclePlaybackDate(config)
      if (data.routes.length === 0 || !date) {
        return 'skip'
      }
      const body: VehicleTracksPhaseConfig = {
        routeIds: data.routes.map(r => r.id),
        date: format(date, 'yyyy-MM-dd'),
      }
      return body
    },
  })
}
