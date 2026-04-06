/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { createError } from 'h3'
import type { ScenarioConfig } from '~~/src/scenario'
import { streamScenario } from '~~/src/scenario'
import { BasicGraphQLClient, apiFetch, logMemory } from '~~/src/core'

export default defineEventHandler(async (event) => {
  logMemory('request-start')

  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  // Validate the config
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  // Set streaming headers
  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')

  if (!event.context.auth0Session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const runtimeConfig = useRuntimeConfig(event)
  let token
  try {
    token = await event.context.auth0Session.getAccessToken()
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Session expired, please log in again' })
  }
  const client = new BasicGraphQLClient(
    runtimeConfig.tlv2.proxyBase.default + '/query',
    apiFetch(runtimeConfig.tlv2?.graphqlApikey || '', token),
  )

  logMemory('before-stream')

  const stream = new ReadableStream({
    async start (controller) {
      await streamScenario(controller, config, client)
      logMemory('stream-complete')
    }
  })

  return sendStream(event, stream)
})
