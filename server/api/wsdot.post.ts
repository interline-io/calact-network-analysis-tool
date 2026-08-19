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
        // out of its return value.
        console.error('WSDOT request failed:', e)
        // Backstop for anything that could throw before it gets that far. A
        // start() that resolves without closing or erroring the controller
        // leaves the response stream open forever: sendStream never settles
        // and the browser blocks on a read that never returns, under a
        // loading modal it cannot dismiss. Erroring an already-closed
        // controller is a no-op, so the normal path is unaffected.
        controller.error(e)
      }
    }
  })

  return sendStream(event, stream)
})
