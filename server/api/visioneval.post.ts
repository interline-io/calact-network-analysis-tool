import { runVisionEvalAnalysisStreaming, type VisionEvalConfig } from '~~/src/analysis/visioneval'
import { setNdjsonStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'
import { compressStream } from '~~/server/utils/compress'

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

  setNdjsonStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      await runVisionEvalAnalysisStreaming(controller, config, client)
    }
  })

  return sendStream(event, compressStream(event, stream))
})
