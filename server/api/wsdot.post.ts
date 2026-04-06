import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { BasicGraphQLClient, apiFetch } from '~~/src/core'

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

  if (!event.context.auth0Session) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  const runtimeConfig = useRuntimeConfig(event)
  let token
  try {
    token = await event.context.auth0Session.getAccessToken()
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Session expired, please log in again' })
  }
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
