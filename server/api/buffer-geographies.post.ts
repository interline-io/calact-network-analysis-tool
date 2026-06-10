// Powers radius/layer changes in the SPA without re-running the full scenario.

import { createError } from 'h3'
import type { BufferFetchConfig } from '~~/src/scenario'
import { streamBufferGeographies } from '~~/src/scenario'
import { BasicGraphQLClient, apiFetch, logMemory } from '~~/src/core'
import { resolveAccessToken } from '~~/server/utils/auth'
import { compressStream } from '~~/server/utils/compress'

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

  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')

  const token = await resolveAccessToken(event)
  const runtimeConfig = useRuntimeConfig(event)
  const client = new BasicGraphQLClient(
    runtimeConfig.tlv2.proxyBase.default + '/query',
    apiFetch(runtimeConfig.tlv2?.graphqlApikey || '', token),
  )

  const stream = new ReadableStream({
    async start (controller) {
      await streamBufferGeographies(controller, config, client)
      logMemory('buffer-stream-complete')
    }
  })

  return sendStream(event, compressStream(event, stream))
})
