// Standalone departures phase: streams departures for explicit route ids,
// filtered to explicit stop ids, over a date range. Taking explicit ids lets a
// client shard one scenario's departures (the dominant cost) across several
// bounded requests and retry failed shards without re-running anything else.

import { createError } from 'h3'
import type { DeparturesPhaseConfig } from '~~/src/scenario'
import { runDeparturesPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: DeparturesPhaseConfig = await readBody(event)

  if (!config.routeIds || config.routeIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'routeIds must be non-empty' })
  }
  // Every route batch needs a non-empty stop filter, from routeStopIds or the
  // scenario-wide fallback; without one the phase silently fetches nothing.
  if (!config.routeStopIds && (!config.stopIds || config.stopIds.length === 0)) {
    throw createError({ statusCode: 400, statusMessage: 'stopIds must be non-empty when routeStopIds is not given' })
  }

  return streamPhaseResponse(event, 'Starting departures phase', (client, emit, onError) =>
    runDeparturesPhase(config, client, emit, { onError }))
})
