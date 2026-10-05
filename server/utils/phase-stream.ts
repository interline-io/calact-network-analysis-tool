// Shared plumbing for the streaming endpoints: auth, GraphQL client, NDJSON
// headers, and the response-stream wrappers around runProgressStream.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { runProgressStream, type ScenarioPhaseName, type ScenarioProgress } from '~~/src/scenario'
import { buildServerGraphQLClient } from './graphql-client'

// NDJSON stream headers, typed application/json: the edge only compresses
// content types on its default list, which excludes application/x-ndjson,
// and our consumers never sniff the type.
export function setStreamHeaders (event: H3Event): void {
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')
}

// Response wrapper for a run that streams NDJSON into the controller. The
// catch is a backstop for throws before the envelope takes over — a start()
// that resolves without settling the controller leaves the response open
// forever. Envelope-wrapped runs must not let their rethrow reach it; use
// streamEnvelopeResponse.
export async function streamServerResponse (
  event: H3Event,
  run: (client: GraphQLClient, controller: ReadableStreamDefaultController) => Promise<unknown>,
) {
  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  const stream = new ReadableStream({
    async start (controller) {
      try {
        await run(client, controller)
      } catch (e) {
        console.error('Stream request failed:', e)
        controller.error(e)
      }
    }
  })

  return sendStream(event, stream)
}

// Response wrapper for envelope-wrapped runs. The envelope reports failures
// on-stream and closes before rethrowing, so the rethrow is swallowed here —
// letting it reach the controller.error backstop would discard the queued
// error frame under backpressure.
export async function streamEnvelopeResponse (
  event: H3Event,
  label: string,
  run: (client: GraphQLClient, controller: ReadableStreamDefaultController) => Promise<unknown>,
) {
  return streamServerResponse(event, (client, controller) =>
    run(client, controller).catch(err => console.error(`${label} failed:`, err)))
}

// Wraps a bare phase run in the shared envelope for the standalone phase
// endpoints; the phase name becomes the stream's announced plan.
export async function streamPhaseResponse (
  event: H3Event,
  phase: ScenarioPhaseName,
  startMessage: string,
  run: (client: GraphQLClient, emit: (progress: ScenarioProgress) => void | Promise<void>, onError: (error: any) => void) => Promise<unknown>,
) {
  return streamEnvelopeResponse(event, `Phase run (${phase})`, (client, controller) =>
    runProgressStream(requestStream(controller), client, { startMessage, phasePlan: [phase] },
      (emit, onError) => run(client, emit, onError)))
}
