// Powers stop-cluster distance changes in the SPA without re-running the full
// scenario. Recomputes only the clusters at the new distance.

import { createError } from 'h3'
import type { StopClusterFetchConfig } from '~~/src/scenario'
import { runStopClustersPhase } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  logMemory('stop-clusters-request-start')

  const config: StopClusterFetchConfig = await readBody(event)

  if (!(config.maxDistanceMeters > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'maxDistanceMeters must be > 0' })
  }
  if (!config.geoDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName is required' })
  }
  if (!config.feedVersions?.length) {
    throw createError({ statusCode: 400, statusMessage: 'feedVersions must be non-empty' })
  }

  return streamPhaseResponse(event, 'Recomputing stop clusters', async (client, emit) => {
    await runStopClustersPhase(config, client, emit)
    logMemory('stop-clusters-stream-complete')
  })
})
