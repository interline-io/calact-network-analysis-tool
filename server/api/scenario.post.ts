/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { type ScenarioConfig, ScenarioDataSender } from '~/src/scenario/scenario'

export default defineEventHandler(async (event) => {
  try {
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

    // Create a readable stream for the response
    const stream = new ReadableStream({
      start (controller) {
        const encoder = new TextEncoder()

        // Simple message sender - just serializes internal StreamingMessage to JSON
        const sendMessage = (message: any) => {
          try {
            const jsonLine = JSON.stringify(message) + '\n'
            controller.enqueue(encoder.encode(jsonLine))
          } catch (error) {
            console.error('Error encoding message:', error)
          }
        }

        // Create ScenarioDataSender instance
        const sender = new ScenarioDataSender(sendMessage)

        // Use the new ScenarioDataSender to process the scenario
        sender.sendScenario(config)
          .then(() => {
            controller.close()
          })
          .catch((error) => {
            console.error('Scenario processing error:', error)
            // Send error message and close
            const errorMessage = {
              type: 'error',
              data: { message: error.message || 'Unknown error' }
            }
            sendMessage(errorMessage)
            controller.close()
          })
      }
    })

    return sendStream(event, stream)
  } catch (error: any) {
    console.error('Scenario endpoint error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'Internal server error'
    })
  }
})
