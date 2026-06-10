// Standalone feed-versions phase: resolves the geographic context and the
// active feed versions within it. Output feeds the stops and flex phases.

import { createError } from 'h3'
import type { FeedVersionsPhaseConfig } from '~~/src/scenario'
import { runFeedVersionsPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: FeedVersionsPhaseConfig = await readBody(event)

  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Either bbox or geographyIds must be provided' })
  }
  if (!config.geoDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName is required' })
  }

  return streamPhaseResponse(event, 'Starting feed-versions phase', (client, emit) =>
    runFeedVersionsPhase(config, client, emit))
})
