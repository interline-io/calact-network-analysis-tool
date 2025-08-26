/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { createError } from 'h3'
import type { ScenarioConfig } from '~/src/scenario/scenario'
import { ScenarioStreamSender } from '~/src/scenario/scenario-streamer'
import { ScenarioFetcher } from '~/src/scenario/scenario-fetcher'
import { extractJwtFromEvent } from 'tlv2-ui/server-utils'
import { createGraphQLClientOnBackend } from 'tlv2-ui/server-utils'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  // Validate the config
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  // Extract and validate JWT token from the incoming request
  const { requireJwt } = extractJwtFromEvent(event)
  const userJwt = requireJwt()

  // TODO: Add role-based access control (e.g., check for 'tl_calact_nat' role)
  // Currently only validates JWT presence, not user permissions

  // Set streaming headers
  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')

  // Create a proxy-based GraphQL client using the utility
  const client = createGraphQLClientOnBackend(event, userJwt)

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      // Create writable stream writer that writes to the response
      const writableStream = new WritableStream({
        write (chunk) {
          controller.enqueue(chunk)
        },
        close () {
          controller.close()
        },
        abort (error) {
          controller.error(error)
        }
      })
      const writer = writableStream.getWriter()

      // Create ScenarioDataSender that writes to our stream
      const scenarioDataSender = new ScenarioStreamSender(writer)

      // Create ScenarioFetcher with streaming callbacks
      const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

      // Start the fetch process (fire and forget - streams handle the rest)
      fetcher.fetch().catch((error) => {
        console.error('Scenario fetch error:', error)
        scenarioDataSender.onError(error)
      })

      await fetcher.fetch()
    }
  })

  return sendStream(event, stream)
})
