import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { useApiFetch } from '~/composables/useApiFetch'
import { runVisionEvalAnalysisStreaming, type VisionEvalConfig } from '~~/src/analysis/visioneval'
import { BasicGraphQLClient } from '~~/src/core'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const { config: configData } = await readBody(event)
  const config: VisionEvalConfig = configData as VisionEvalConfig

  // Validate the config
  if (!config.state) {
    throw createError({
      statusCode: 400,
      statusMessage: 'State is required'
    })
  }

  if (!config.year || typeof config.year !== 'number') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Year is required and must be a number'
    })
  }

  // Set streaming headers
  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')

  // Create a proxy-based GraphQL client
  const client = new BasicGraphQLClient(
    useTransitlandApiEndpoint('/query', event),
    await useApiFetch(event),
  )

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      await runVisionEvalAnalysisStreaming(controller, config, client)
    }
  })

  return sendStream(event, stream)
})
