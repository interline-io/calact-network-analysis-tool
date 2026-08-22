// Phase 3: the aggregation layer's census geography for each stop. Depends
// only on the stop ids, so it runs alongside routes and departures rather than
// gating them the way riding on the stop query did.

import { chunkArray, type GraphQLClient } from '~~/src/core'
import { stopCensusQuery, type StopCensusGeography } from '~~/src/tl'
import { phaseQueue, type PhaseEmit, type PhaseOpts } from './common'

// Ids per request. The server's root `stops` limit maxes out here and truncates
// silently above it, and it applies whether or not ids are given.
const STOP_ID_BATCH_SIZE = 1000

export interface StopCensusPhaseConfig {
  stopIds: number[]
  geoDatasetName: string
  // The single layer to fetch. Every consumer reads one layer, so a layer
  // change re-runs this phase rather than the whole scenario.
  censusLayer: string
}

export async function runStopCensusPhase (
  config: StopCensusPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const { queue, progressEvent, done } = phaseQueue<number[]>('stop-census', emit, chunk => fetchChunk(chunk), opts)

  async function fetchChunk (stopIds: number[]): Promise<void> {
    const response = await client.query<{
      stops: { id: number, census_geographies: StopCensusGeography[] }[]
    }>(stopCensusQuery, {
      ids: stopIds,
      limit: stopIds.length,
      dataset: config.geoDatasetName,
      layer: config.censusLayer,
    })
    // A stop outside every geography of the layer comes back with none; it
    // still gets an entry so a consumer can tell "none" from "not fetched".
    const entries: [number, StopCensusGeography[]][] = (response.data?.stops || [])
      .map(stop => [stop.id, stop.census_geographies || []])
    await emit({ ...progressEvent(), partialData: { stopCensusGeographies: entries } })
  }

  queue.enqueue(chunkArray(config.stopIds, STOP_ID_BATCH_SIZE))
  await queue.run()
  console.log(`[StopCensus] Fetched ${config.censusLayer} geographies for ${config.stopIds.length} stops`)
  await done()
}
