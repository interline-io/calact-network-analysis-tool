/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import type { ScenarioConfig } from '~/src/scenario/scenario'
import { ScenarioStreamSender } from '~/src/scenario/scenario-streamer'
import { ScenarioFetcher } from '~/src/scenario/scenario-fetcher'
import { BasicGraphQLClient } from '~/src/graphql'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  // Validate the config
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw new Error('Either bbox or geographyIds must be provided')
  }

  // Set streaming headers
  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')

  // Create GraphQL client
  const client = new BasicGraphQLClient(
    process.env.TRANSITLAND_API_ENDPOINT || 'https://transit.land/api/v2/query',
    process.env.TRANSITLAND_API_KEY || 'test-key'
  )

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

      // Start the fetch process
      try {
        await fetcher.fetch()
      } catch (error) {
        console.error('Scenario fetch error:', error)
        scenarioDataSender.onError(error)
      }
    }
  })

  return sendStream(event, stream)
})
