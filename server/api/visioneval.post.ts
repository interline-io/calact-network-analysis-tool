import type { VisionEvalConfig } from '~~/src/analysis/visioneval'
import { serveStreamRun } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const body: { config: VisionEvalConfig } = await readBody(event)
  const config = body.config

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

  return serveStreamRun(event, 'visioneval', body)
})
