// Standalone census-values phase: ACS values for the aggregation layer, for
// a query area of geographyIds or a plain bbox.

import { createError } from 'h3'
import { hasSearchArea } from '~~/src/core'
import type { CensusValuesPhaseConfig } from '~~/src/scenario'
import { runCensusValuesPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: CensusValuesPhaseConfig = await readBody(event)

  if (!hasSearchArea(config)) {
    throw createError({ statusCode: 400, statusMessage: 'Either bbox or geographyIds must be provided' })
  }
  if (!config.geoDatasetName || !config.tableDatasetName || !config.aggregateLayer) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName, tableDatasetName, and aggregateLayer are required' })
  }

  return streamPhaseResponse(event, 'census-values', 'Starting census-values phase', (client, emit) =>
    runCensusValuesPhase(config, client, emit))
})
