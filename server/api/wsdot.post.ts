import { useApiEndpoint } from '~/composables/useApiEndpoint'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import type { WSDOTReportConfig } from '~/src/reports/wsdot'
import type { ScenarioData } from '~/src/scenario/scenario'
import { BasicGraphQLClient } from '~/src/graphql'
import { useApiFetch } from '~/composables/useApiFetch'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)
    const { config, scenarioData }: { config: WSDOTReportConfig, scenarioData: ScenarioData } = body

    if (!config || !scenarioData) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Missing required config or scenarioData'
      })
    }

    // TODO: Add role-based access control (e.g., check for 'tl_calact_nat' role)
    // Currently only validates JWT presence, not user permissions

    // Create a proxy-based GraphQL client using the utility
    const apiFetch = await useApiFetch()
    const client = new BasicGraphQLClient(
      useApiEndpoint('/query'),
      apiFetch,
    )

    // Create WSDOT fetcher and run analysis
    const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)

    // Run the analysis and return results
    const result = await wsdotFetcher.fetch()

    return result
  } catch (error) {
    console.error('WSDOT analysis error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: error instanceof Error ? error.message : 'Internal server error'
    })
  }
})
