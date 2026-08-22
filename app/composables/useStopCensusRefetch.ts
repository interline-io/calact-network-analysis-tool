// Debounced per-stop census refetch on Aggregate-by layer change. The phase
// fetches one layer, so the previous layer's entries are wrong rather than
// stale the moment the selector moves. Runs alongside useAggregateRefetch,
// which covers the ACS half of the same change.

import { useScenarioDisplay } from './useScenarioDisplay'
import { useStreamingRefetch, type StreamingRefetchDeps } from './useStreamingRefetch'
import { phaseEnabled, type StopCensusPhaseConfig } from '~~/src/scenario'

export type UseStopCensusRefetchDeps = StreamingRefetchDeps

export function useStopCensusRefetch (deps: UseStopCensusRefetchDeps): void {
  const { aggregateLayer } = useScenarioDisplay()

  useStreamingRefetch(deps, {
    watchSources: [aggregateLayer],
    endpoint: '/api/scenario/stop-census',
    loadingMessage: 'Reloading stop census areas...',
    // Every consumer filters on layer_name, so keeping the old layer's entries
    // would read as no stops in any geography rather than as stale ones.
    clearBeforeFetch: true,
    clearStale: receiver => receiver.clearStopCensusGeographies(),
    plan: (data, config) => {
      if (!phaseEnabled('stop-census', config) || data.stops.length === 0) {
        return 'skip'
      }
      const body: StopCensusPhaseConfig = {
        stopIds: data.stops.map(s => s.id),
        geoDatasetName: config.geoDatasetName,
        // The predicate above guarantees this is set.
        censusLayer: config.aggregateLayer!,
      }
      return body
    },
  })
}
