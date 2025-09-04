import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import type { WSDOTReportConfig } from '~/src/reports/wsdot'
import { BasicGraphQLClient } from '~/src/graphql'
import { useApiFetch } from '~/composables/useApiFetch'
import { ScenarioDataReceiver, ScenarioFetcher } from '~/src/scenario/scenario-fetcher'
import { ScenarioStreamReceiver, ScenarioStreamSender } from '~/src/scenario/scenario-streamer'

const requestStream = (controller: ReadableStreamDefaultController): WritableStream => {
  // Create writable stream writer that writes to the response
  return new WritableStream({
    write (chunk) {
      controller.enqueue(chunk)
    },
    close () {
      controller.close()
    },
    abort (error) {
      controller.error(error)
    }
  })
}

const multiplexStream = (originalStream: WritableStream): { inputStream: WritableStream, outputStream: ReadableStream } => {
  // Create a transform stream that splits data to two destinations
  const originalWriter = originalStream.getWriter()

  const { readable, writable } = new TransformStream({
    async transform (chunk, controller) {
      // Send chunk to the new output stream
      controller.enqueue(chunk)
      // Also write to the original stream
      await originalWriter.write(chunk)
    },
    async flush () {
      // Close both streams when done
      await originalWriter.close()
    }
  })

  return {
    inputStream: writable, // Stream to write data into
    outputStream: readable // New stream that receives the same data
  }
}

export default defineEventHandler(async (event) => {
  // Parse the request body
  const { config: configData } = await readBody(event)
  const config: WSDOTReportConfig = configData as WSDOTReportConfig
  console.log('config:', JSON.stringify(configData, null, 2))

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
    useTransitlandApiEndpoint('/query'),
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

      // Wait for fetcher
      await fetcher.fetch()

      console.log('✅ Scenario fetch completed!')

      // Run wsdot analysis
      const scenarioData = receiver.getCurrentData()
      const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)
      const wsdotResult = await wsdotFetcher.fetch()

      console.log('✅ WSDOT analysis completed!')

      // Update the client with the wsdot result
      scenarioDataSender.onProgress({
        isLoading: true,
        currentStage: 'schedules', // TODO - extraData stage?
        extraData: wsdotResult
      })

      // Final complete - close the multiplexed stream
      writer.close()

      // Ensure all scenario client progress has been processed
      await scenarioClientProgress
    }
  })

  return sendStream(event, stream)
})
