// Standalone stop-census phase: the aggregation layer's geography for a set of
// stop ids. Re-run on its own when the aggregation layer changes, since the
// phase fetches one layer.

import { createError } from 'h3'
import type { StopCensusPhaseConfig } from '~~/src/scenario'
import { runStopCensusPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: StopCensusPhaseConfig = await readBody(event)

  if (!config.stopIds || config.stopIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'stopIds must be non-empty' })
  }
  if (!config.geoDatasetName || !config.censusLayer) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName and censusLayer are required' })
  }

  return streamPhaseResponse(event, 'stop-census', 'Starting stop census phase', (client, emit, onError) =>
    runStopCensusPhase(config, client, emit, { onError }))
})
