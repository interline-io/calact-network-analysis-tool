// Standalone stops phase: streams stops (with route_stops) for the given
// feed versions. Clients derive stop ids and route ids from the stream.

import { createError } from 'h3'
import type { StopsPhaseConfig } from '~~/src/scenario'
import { hasSearchArea } from '~~/src/scenario'
import { serveStreamRun } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: StopsPhaseConfig = await readBody(event)

  if (!config.feedVersions || config.feedVersions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'feedVersions must be non-empty' })
  }
  if (!hasSearchArea(config)) {
    throw createError({ statusCode: 400, statusMessage: 'Either bbox or geographyIds must be provided' })
  }
  return serveStreamRun(event, 'scenario/stops', config)
})
