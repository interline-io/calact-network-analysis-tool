// Server-side streaming scenario endpoint.

import { createError } from 'h3'
import type { ScenarioConfig } from '~~/src/scenario'
import { hasSearchArea, streamScenario } from '~~/src/scenario'
import { logMemory } from '~~/src/core'
import { streamServerResponse } from '~~/server/utils/phase-stream'

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

  return streamServerResponse(event, async (client, controller) => {
    // The envelope reports failures on-stream and closes before rethrowing;
    // the rethrow must not reach the controller.error backstop, which would
    // discard the queued error frame.
    await streamScenario(controller, config, client)
      .catch(err => console.error('Scenario run failed:', err))
    logMemory('stream-complete')
  })
})
