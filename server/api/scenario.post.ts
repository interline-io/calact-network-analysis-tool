/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { createError } from 'h3'
import { useApiFetch } from '~/composables/useApiFetch'
import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import type { ScenarioConfig } from '~~/src/scenario'
import { streamScenario } from '~~/src/scenario'
import { BasicGraphQLClient } from '~~/src/core'

function logMemory (label: string) {
  if (process.env.DEBUG_MEMORY) {
    const usage = process.memoryUsage()
    const heapMB = (usage.heapUsed / 1024 / 1024).toFixed(1)
    const rssMB = (usage.rss / 1024 / 1024).toFixed(1)
    console.log(`[MEM ${label}] heap: ${heapMB}MB, rss: ${rssMB}MB`)
  }
}

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

  // TODO: Add role-based access control (e.g., check for 'tl_calact_nat' role)
  // Create a proxy-based GraphQL client using the utility
  const client = new BasicGraphQLClient(
    useTransitlandApiEndpoint('/query', event),
    await useApiFetch(event),
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
