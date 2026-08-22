// Buffer-clipped tract outlines for the WSDOT report's map overlay, fetched
// only when the viewer asks. The stop sets come from the report the client
// already holds, so nothing is re-classified here.

import { createError } from 'h3'
import type { WSDOTLevelGeometryConfig } from '~~/src/analysis/wsdot'
import { runWsdotLevelGeometryPhase } from '~~/src/analysis/wsdot'
import { streamPhaseResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  const config: WSDOTLevelGeometryConfig = await readBody(event)

  if (!config.levels || config.levels.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'levels must be non-empty' })
  }
  if (!config.geoDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName is required' })
  }
  if (!(config.stopBufferRadius > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'stopBufferRadius must be greater than zero' })
  }

  return streamPhaseResponse(event, 'wsdot-geographies', 'Fetching stop buffer outlines', (client, emit) =>
    runWsdotLevelGeometryPhase(config, client, emit))
})
