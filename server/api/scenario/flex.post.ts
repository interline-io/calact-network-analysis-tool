// Standalone flex phase: streams GTFS-Flex service areas + flex departure
// dates for the given feed versions. Independent of stops/departures, so a
// flex-only scenario is just feed-versions + this.

import { createError } from 'h3'
import type { FlexPhaseConfig } from '~~/src/scenario'
import { runFlexPhase } from '~~/src/scenario'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: FlexPhaseConfig = await readBody(event)

  if (!config.feedVersions || config.feedVersions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'feedVersions must be non-empty' })
  }

  return streamPhaseResponse(event, 'Starting flex phase', (client, emit, onError) =>
    runFlexPhase(config, client, emit, { onError }))
})
