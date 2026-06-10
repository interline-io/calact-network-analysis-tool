// Standalone routes phase: streams route details for explicit route ids
// (discovered client-side from streamed stops' route_stops).

import { createError } from 'h3'
import type { RoutesPhaseConfig } from '~~/src/scenario'
import { runRoutesPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: RoutesPhaseConfig = await readBody(event)

  if (!config.routeIds || config.routeIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'routeIds must be non-empty' })
  }

  return streamPhaseResponse(event, 'Starting routes phase', (client, emit, onError) =>
    runRoutesPhase(config, client, emit, { onError }))
})
