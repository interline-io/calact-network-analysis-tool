import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { setStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'

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

  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      try {
        await runAnalysis(controller, config, client)
      } catch (e) {
        // runAnalysis reports the failure on the stream and closes it before
        // rethrowing, which it does for in-process callers that build a report
        // out of its return value. There is nothing left to tell the client.
        console.error('WSDOT request failed:', e)
      }
    }
  })

  return sendStream(event, stream)
})
