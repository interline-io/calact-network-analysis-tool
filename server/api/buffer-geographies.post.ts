// Powers radius/layer changes in the SPA without re-running the full scenario.

import { createError } from 'h3'
import type { BufferFetchConfig } from '~~/src/scenario'
import { streamBufferGeographies } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { setStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'

export default defineEventHandler(async (event) => {
  logMemory('buffer-request-start')

  const config: BufferFetchConfig = await readBody(event)

  if (!(config.radius > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'radius must be > 0' })
  }
  if (!config.layer) {
    throw createError({ statusCode: 400, statusMessage: 'layer is required' })
  }
  if (!config.geoDatasetName || !config.tableDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName and tableDatasetName are required' })
  }
  const totalIds = (config.stopIds?.length ?? 0) + (config.routeIds?.length ?? 0) + (config.agencyIds?.length ?? 0)
  if (totalIds === 0) {
    throw createError({ statusCode: 400, statusMessage: 'at least one of stopIds/routeIds/agencyIds must be non-empty' })
  }

  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  const stream = new ReadableStream({
    async start (controller) {
      await streamBufferGeographies(controller, config, client)
      logMemory('buffer-stream-complete')
    }
  })

  return sendStream(event, stream)
})
