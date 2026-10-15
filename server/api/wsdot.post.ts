import type { WSDOTReportConfig } from '~~/src/analysis/wsdot'
import { hasSearchArea } from '~~/src/scenario'
import { serveStreamRun } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const body: { config: WSDOTReportConfig } = await readBody(event)

  if (!hasSearchArea(body.config)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  return serveStreamRun(event, 'wsdot', body)
})
