// Powers deferred flex-areas loads in the SPA (first enable of the Flex
// Services display toggle) without re-running the scenario.

import { createError } from 'h3'
import type { FlexAreasRequestBody } from '~~/src/scenario'
import { streamFlexAreas } from '~~/src/scenario'
import { BasicGraphQLClient, apiFetch, logMemory } from '~~/src/core'
import { resolveAccessToken } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  logMemory('flex-areas-request-start')

  const raw = await readBody(event)

  if (!Array.isArray(raw?.feedVersions) || raw.feedVersions.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'feedVersions must be non-empty' })
  }
  if (!raw.startDate) {
    throw createError({ statusCode: 400, statusMessage: 'startDate is required' })
  }

  // Dates arrive as ISO strings over JSON.
  const body: FlexAreasRequestBody = {
    feedVersions: raw.feedVersions,
    startDate: new Date(raw.startDate),
    endDate: raw.endDate ? new Date(raw.endDate) : undefined,
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
      await streamFlexAreas(controller, body, client)
      logMemory('flex-areas-stream-complete')
    }
  })

  return sendStream(event, stream)
})
