// Standalone fares phase: streams a standard-fare summary per route for the
// given feed versions, from the route and stop ids a stops run discovered.

import { createError } from 'h3'
import type { FaresPhaseConfig } from '~~/src/scenario'
import { serveStreamRun } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: FaresPhaseConfig = await readBody(event)

  if (!config.feedVersions || config.feedVersions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'feedVersions must be non-empty' })
  }

  return serveStreamRun(event, 'scenario/fares', config)
})
