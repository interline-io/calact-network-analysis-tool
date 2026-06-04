// Powers deferred per-layer census-values loads in the SPA (aggregated tab,
// Show Agg. Areas, aggregate-layer changes) without re-running the scenario.

import { createError } from 'h3'
import type { CensusValuesRequestBody } from '~~/src/scenario'
import { streamCensusValues } from '~~/src/scenario'
import { BasicGraphQLClient, apiFetch, logMemory } from '~~/src/core'
import { resolveAccessToken } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  logMemory('census-values-request-start')

  const body: CensusValuesRequestBody = await readBody(event)

  if (!body.layer) {
    throw createError({ statusCode: 400, statusMessage: 'layer is required' })
  }
  if (!body.geoDatasetName || !body.tableDatasetName) {
    throw createError({ statusCode: 400, statusMessage: 'geoDatasetName and tableDatasetName are required' })
  }
  if (!body.bbox && (body.geographyIds?.length ?? 0) === 0) {
    throw createError({ statusCode: 400, statusMessage: 'one of bbox or geographyIds is required' })
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
      await streamCensusValues(controller, body, client)
      logMemory('census-values-stream-complete')
    }
  })

  return sendStream(event, stream)
})
