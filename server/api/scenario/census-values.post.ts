// Standalone census-values phase: ACS values for the aggregation layer.
// Accepts geographyIds (re-resolved server-side) or a plain bbox, so callers
// don't need to thread resolved geography context between requests.

import { createError } from 'h3'
import type { CensusValuesPhaseConfig } from '~~/src/scenario'
import { runCensusValuesPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: CensusValuesPhaseConfig = await readBody(event)

  if (!config.bbox && !config.within && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'One of bbox, within, or geographyIds must be provided' })
  }
  if (!config.geoDatasetName || !config.tableDatasetName || !config.aggregateLayer) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName, tableDatasetName, and aggregateLayer are required' })
  }

  return streamPhaseResponse(event, 'Starting census-values phase', (client, emit) =>
    runCensusValuesPhase(config, client, emit))
})
