import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { streamServerResponse } from '~~/server/utils/phase-stream'

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

  return streamServerResponse(event, (client, controller) =>
    runAnalysis(controller, config, client))
})
