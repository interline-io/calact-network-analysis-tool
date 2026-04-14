import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { BasicGraphQLClient, apiFetch } from '~~/src/core'
import { resolveAccessToken } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const { config: configData } = await readBody(event)
  const config: WSDOTReportConfig = configData as WSDOTReportConfig

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
      await runAnalysis(controller, config, client)
    }
  })

  return sendStream(event, stream)
})
