import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { hasSearchArea } from '~~/src/core'
import { streamEnvelopeResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const { config: configData } = await readBody(event)
  const config: WSDOTReportConfig = configData as WSDOTReportConfig

  if (!hasSearchArea(config)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'One of bbox, geographyIds or polygon must be provided'
    })
  }

  return streamEnvelopeResponse(event, 'WSDOT run', (client, controller) =>
    runAnalysis(controller, config, client))
})
