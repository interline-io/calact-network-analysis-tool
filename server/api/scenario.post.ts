/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { createError } from 'h3'
import type { ScenarioConfig } from '~~/src/scenario'
import { streamScenario } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { setNdjsonStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'
import { compressStream } from '~~/server/utils/compress'

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

  setNdjsonStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  logMemory('before-stream')

  const stream = new ReadableStream({
    async start (controller) {
      await streamScenario(controller, config, client)
      logMemory('stream-complete')
    }
  })

  return sendStream(event, compressStream(event, stream))
})
