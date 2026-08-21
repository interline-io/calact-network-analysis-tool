// Server-side streaming scenario endpoint.

import { createError } from 'h3'
import type { ScenarioConfig } from '~~/src/scenario'
import { hasSearchArea, streamScenario } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { streamEnvelopeResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  logMemory('request-start')

  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  if (!hasSearchArea(config)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  return streamEnvelopeResponse(event, 'Scenario run', async (client, controller) => {
    await streamScenario(controller, config, client)
    logMemory('stream-complete')
  })
})
