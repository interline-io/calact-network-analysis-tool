/**
 * Server-side streaming scenario endpoint
 * Uses unified streaming implementation
 */

import type { ScenarioConfig } from '~/src/scenario'
import type {
  ScenarioStreamingMessage,
  ProgressMessage,
  ErrorMessage
} from '~/src/streaming/scenario'
import { processStreamingScenario } from '~/src/streaming/scenario'

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

        const sendMessage = (message: ScenarioStreamingMessage) => {
          try {
            const jsonLine = JSON.stringify(message) + '\n'
            controller.enqueue(encoder.encode(jsonLine))
          } catch (error) {
            console.error('Error encoding message:', error)
          }
        }

        const sendProgress = (phase: string, current: number, total: number, message: string) => {
          const progressMessage: ProgressMessage = {
            type: 'progress',
            data: { phase: phase as any, current, total, message }
          }
          sendMessage(progressMessage)
        }

        const sendError = (error: any) => {
          const errorMessage: ErrorMessage = {
            type: 'error',
            data: { message: error.message || 'Unknown error' }
          }
          sendMessage(errorMessage)
          controller.close()
        }

        // Process scenario using unified implementation
        processStreamingScenario(config, sendMessage, sendProgress)
          .then(() => {
            controller.close()
          })
          .catch((error) => {
            console.error('Scenario processing error:', error)
            sendError(error)
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
