// Debounced per-stop census refetch on Aggregate-by layer change. The
// stop-census phase fetches one layer, so the previous layer's entries are
// wrong rather than stale the moment the selector moves — without this the
// aggregation table and the choropleth silently come back empty.
//
// Runs alongside useAggregateRefetch, which recomputes the ACS values for the
// same layer change; the shared refetch counter keeps the loading modal open
// until both settle. Streaming/abort/debounce machinery lives in
// useStreamingRefetch.

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
    // The old layer's entries can't be shown against the new one, and every
    // consumer filters on layer_name, so leaving them would read as no stops
    // in any geography.
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
