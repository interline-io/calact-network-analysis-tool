// Standalone vehicle-tracks phase: streams every run the given routes make on
// one calendar day, for the map's vehicle playback.

import { createError } from 'h3'
import type { VehicleTracksPhaseConfig } from '~~/src/scenario'
import { runVehicleTracksPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: VehicleTracksPhaseConfig = await readBody(event)

  if (!config.routeIds || config.routeIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'routeIds must be non-empty' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.date || '')) {
    throw createError({ statusCode: 400, statusMessage: 'date must be yyyy-MM-dd' })
  }

  return streamPhaseResponse(event, 'vehicle-tracks', 'Starting vehicle tracks phase', (client, emit, onError) =>
    runVehicleTracksPhase(config, client, emit, { onError }))
})
