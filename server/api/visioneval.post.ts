import { runVisionEvalAnalysisStreaming, type VisionEvalConfig } from '~~/src/analysis/visioneval'
import { BasicGraphQLClient, apiFetch } from '~~/src/core'
import { resolveAccessToken } from '~~/server/utils/auth'

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

  const runtimeConfig = useRuntimeConfig(event)
  const requireLogin = runtimeConfig.public?.tlv2?.requireLogin ?? true
  const token = await resolveAccessToken(event, requireLogin)
  const client = new BasicGraphQLClient(
    runtimeConfig.tlv2.proxyBase.default + '/query',
    apiFetch(runtimeConfig.tlv2?.graphqlApikey || '', token),
  )

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      await runVisionEvalAnalysisStreaming(controller, config, client)
    }
  })

  return sendStream(event, stream)
})
