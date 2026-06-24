// Powers Aggregate-by layer changes in the SPA without re-running the full
// scenario. Recomputes only the ACS census values/geographies for the new layer.

import { createError } from 'h3'
import type { CensusValuesPhaseConfig } from '~~/src/scenario'
import { streamCensusValues } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { setStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'

export default defineEventHandler(async (event) => {
  logMemory('census-values-request-start')

  const config: CensusValuesPhaseConfig = await readBody(event)

  if (!config.geoDatasetName || !config.tableDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName and tableDatasetName are required' })
  }
  if (!config.aggregateLayer) {
    throw createError({ statusCode: 400, statusMessage: 'aggregateLayer is required' })
  }
  if (!config.bbox && !(config.geographyIds && config.geographyIds.length > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'bbox or geographyIds is required' })
  }

  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  const stream = new ReadableStream({
    async start (controller) {
      await streamCensusValues(controller, config, client)
      logMemory('census-values-stream-complete')
    }
  })

  return sendStream(event, stream)
})
