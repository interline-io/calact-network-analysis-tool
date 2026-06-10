import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { setNdjsonStreamHeaders } from '~~/server/utils/phase-stream'
import { buildServerGraphQLClient } from '~~/server/utils/graphql-client'
import { compressStream } from '~~/server/utils/compress'

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

  setNdjsonStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      await runAnalysis(controller, config, client)
    }
  })

  return sendStream(event, compressStream(event, stream))
})
