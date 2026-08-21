// Server-side streaming scenario endpoint.

import { createError } from 'h3'
import type { ScenarioConfig } from '~~/src/scenario'
import { streamScenario } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { streamServerResponse } from '~~/server/utils/phase-stream'

export default defineEventHandler(async (event) => {
  logMemory('request-start')

  // Parse the request body
  const config: ScenarioConfig = await readBody(event)

  // Validate the config
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Either bbox or geographyIds must be provided'
    })
  }

  return streamServerResponse(event, async (client, controller) => {
    await streamScenario(controller, config, client)
    logMemory('stream-complete')
  })
})
