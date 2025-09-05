import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import type { WSDOTReport, WSDOTReportConfig } from '~/src/reports/wsdot'
import { BasicGraphQLClient } from '~/src/graphql'
import { useApiFetch } from '~/composables/useApiFetch'
import { ScenarioDataReceiver, ScenarioFetcher, ScenarioStreamReceiver, ScenarioStreamSender } from '~/src/scenario'
import { multiplexStream, requestStream } from '~/src/stream'

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
      // Create a multiplex stream that writes to both the response and a new output stream
      const { inputStream, outputStream } = multiplexStream(requestStream(controller))
      const writer = inputStream.getWriter()

      // Configure fetcher/sender
      const scenarioDataSender = new ScenarioStreamSender(writer)
      const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

      // Configure client/receiver
      const receiver = new ScenarioDataReceiver()
      const scenarioDataClient = new ScenarioStreamReceiver()
      const scenarioClientProgress = scenarioDataClient.processStream(outputStream, receiver)

      // Start the fetch process
      await fetcher.fetch()

      // Run wsdot analysis
      const scenarioData = receiver.getCurrentData()
      const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)
      let wsdotResult: WSDOTReport | null = null
      wsdotResult = await wsdotFetcher.fetch()

      // Update the client with the wsdot result
      scenarioDataSender.onProgress({
        isLoading: true,
        currentStage: 'schedules', // TODO - extraData stage?
        extraData: wsdotResult
      })
      scenarioDataSender.onComplete()

      // Final complete - close the multiplexed stream
      writer.close()

      // Ensure all scenario client progress has been processed
      await scenarioClientProgress
    }
  })

  return sendStream(event, stream)
})
