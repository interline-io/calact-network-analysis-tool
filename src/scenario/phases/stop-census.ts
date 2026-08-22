// Phase 3: the aggregation layer's census geography for each stop. Depends
// only on the stop ids, so it runs alongside routes and departures rather than
// gating them the way riding on the stop query did.

import { chunkArray, type GraphQLClient } from '~~/src/core'
import { stopCensusQuery, type StopCensusGeography, type StopCensusGql } from '~~/src/tl'
import { phaseQueue, type PhaseEmit, type PhaseOpts } from './common'

// Ids per request. The server's root `stops` limit maxes out here, and it
// applies whether or not ids are given — the default is 100.
const STOP_ID_BATCH_SIZE = 1000

export interface StopCensusPhaseConfig {
  stopIds: number[]
  geoDatasetName: string
  // The single layer to fetch. Every consumer reads one layer, so a layer
  // change re-runs this phase rather than the whole scenario.
  censusLayer: string
  // Default STOP_ID_BATCH_SIZE; the server rejects nothing above it, it just
  // truncates, so lower it rather than raise it.
  stopChunkSize?: number
}

export async function runStopCensusPhase (
  config: StopCensusPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const chunkSize = Math.min(config.stopChunkSize ?? STOP_ID_BATCH_SIZE, STOP_ID_BATCH_SIZE)
  const { queue, progressEvent, done } = phaseQueue<number[]>('stop-census', emit, chunk => fetchChunk(chunk), opts)

  async function fetchChunk (stopIds: number[]): Promise<void> {
    const response = await client.query<{ stops: StopCensusGql[] }>(stopCensusQuery, {
      ids: stopIds,
      limit: stopIds.length,
      dataset: config.geoDatasetName,
      layer: config.censusLayer,
    })
    const entries: [number, StopCensusGeography[]][] = []
    for (const stop of response.data?.stops || []) {
      // A stop outside every geography of the layer comes back with none; it
      // still gets an entry so a consumer can tell "none" from "not fetched".
      entries.push([stop.id, stop.census_geographies || []])
    }
    await emit({ ...progressEvent(), partialData: { stopCensusGeographies: entries } })
  }

  queue.enqueue(chunkArray(config.stopIds, chunkSize))
  await queue.run()
  console.log(`[StopCensus] Fetched ${config.censusLayer} geographies for ${config.stopIds.length} stops`)
  await done()
}
