/**
 * Server-side streaming scenario endpoint
 * Uses new ScenarioDataSender class for streaming implementation
 */

import { createError, getRequestURL } from 'h3'
import { useApiFetch } from '~/composables/useApiFetch'
import { useTransitlandApiEndpoint } from '~/composables/useTransitlandApiEndpoint'
import type { ScenarioConfig } from '~~/src/scenario'
import { runScenarioFetcher } from '~~/src/scenario'
import { BasicGraphQLClient } from '~~/src/core'

/**
 * TEMPORARY: Static flex areas GeoJSON file path
 * TODO: Remove when transitland-server GraphQL resolvers for GTFS-Flex are ready
 */
const FLEX_AREAS_GEOJSON_PATH = '/wsdot-all-flex-areas.geojson'

export default defineEventHandler(async (event) => {
  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  // Validate the config
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  // If flex areas are requested, construct the URL to the static GeoJSON
  // TEMPORARY: This will be replaced with GraphQL query when API is ready
  if (config.includeFlexAreas && !config.flexAreasUrl) {
    const requestUrl = getRequestURL(event)
    config.flexAreasUrl = `${requestUrl.origin}${FLEX_AREAS_GEOJSON_PATH}`
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
      await runScenarioFetcher(controller, config, client)
    }
  })

  return sendStream(event, stream)
})
