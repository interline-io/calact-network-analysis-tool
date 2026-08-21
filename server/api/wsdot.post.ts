import { runAnalysis, type WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { hasSearchArea } from '~~/src/scenario'
import { streamServerResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const { config: configData } = await readBody(event)
  const config: WSDOTReportConfig = configData as WSDOTReportConfig

  if (!hasSearchArea(config)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  return streamServerResponse(event, (client, controller) =>
    // The envelope reports failures on-stream and closes before rethrowing
    // (for in-process callers that read the return value); the rethrow must
    // not reach the controller.error backstop, which would discard the
    // queued error frame.
    runAnalysis(controller, config, client)
      .catch(err => console.error('WSDOT run failed:', err)))
})
