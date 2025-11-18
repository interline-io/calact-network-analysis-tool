import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { useApiFetch } from '~/composables/useApiFetch'
import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { BasicGraphQLClient } from '~~/src/core'

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

  // TODO: Add role-based access control (e.g., check for 'tl_calact_nat' role)
  // Create a proxy-based GraphQL client using the utility
  const client = new BasicGraphQLClient(
    useTransitlandApiEndpoint('/query', event),
    await useApiFetch(event),
  )

  // Create a readable stream for the response
  const stream = new ReadableStream({
    async start (controller) {
      await runAnalysis(controller, config, client)
    }
  })

  return sendStream(event, stream)
})
