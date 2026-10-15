import { runVisionEvalAnalysisStreaming, type VisionEvalConfig } from '~~/src/analysis/visioneval'
import { streamEnvelopeResponse } from '~~/server/utils/phase-stream'

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

  return streamEnvelopeResponse(event, 'VisionEval run', (client, controller) =>
    runVisionEvalAnalysisStreaming(controller, config, client))
})
