// Standalone departures phase: streams stop departures for explicit stop ids
// and a date range. Taking explicit ids lets a client shard one scenario's
// departures (the dominant cost) across several bounded requests and retry
// failed shards without re-running anything else.

import { createError } from 'h3'
import type { DeparturesPhaseConfig } from '~~/src/scenario'
import { runDeparturesPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: DeparturesPhaseConfig = await readBody(event)

  if (!config.stopIds || config.stopIds.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'stopIds must be non-empty' })
  }

  return streamPhaseResponse(event, 'Starting departures phase', (client, emit, onError) =>
    runDeparturesPhase(config, client, emit, { onError }))
})
