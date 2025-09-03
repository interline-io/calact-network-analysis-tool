import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import type { WSDOTReportConfig } from '~/src/reports/wsdot'
import { BasicGraphQLClient } from '~/src/graphql'
import { useApiFetch } from '~/composables/useApiFetch'
import { ScenarioDataReceiver, ScenarioFetcher } from '~/src/scenario/scenario-fetcher'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { config }: { config: WSDOTReportConfig } = body

    if (!config) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required config or scenarioData'
      })
    }

    // Create a proxy-based GraphQL client using the utility
    const client = new BasicGraphQLClient(
      useTransitlandApiEndpoint('/query'),
      await useApiFetch(event),
    )

    // Run base analysis
    const scenarioDataReceiver = new ScenarioDataReceiver()
    const fetcher = new ScenarioFetcher(config, client, scenarioDataReceiver)
    await fetcher.fetch()
    const scenarioData = scenarioDataReceiver.getCurrentData()

    // Run wsdot analysis
    const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)
    const result = await wsdotFetcher.fetch()

    return result
  } catch (error) {
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Internal server error'
    })
  }
})
