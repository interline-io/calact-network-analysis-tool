// Shared plumbing for the streaming endpoints: auth, GraphQL client
// construction, NDJSON headers, and the response-stream wrapper around a run.
// The ready/complete/error envelope itself is runProgressStream in
// src/scenario, shared with the CLI and in-process runs.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { runProgressStream, type ScenarioPhaseName, type ScenarioProgress } from '~~/src/scenario'
import { buildServerGraphQLClient } from './graphql-client'

// Headers for the NDJSON progress streams. The body is NDJSON, but typed as
// application/json: compression is the edge's job (the Cloudflare workers
// runtime strips origin Content-Encoding), and the edge only compresses
// content types on its default list — which includes application/json but
// not application/x-ndjson. Our stream consumers never sniff the type.
export function setStreamHeaders (event: H3Event): void {
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')
}

// Response wrapper for a run that streams NDJSON into the controller. The
// catch here is a backstop for throws that happen before the envelope takes
// over: a start() that resolves without closing or erroring the controller
// leaves the response open forever — the browser blocks on a read that never
// returns, under a loading modal it cannot dismiss.
//
// Envelope-wrapped runs must NOT let their rethrow reach this backstop: the
// envelope has already reported the error on-stream and closed, and erroring
// the controller while that error frame is still queued (a backpressured
// consumer) resets the queue and discards it — the client would then see a
// generic failure instead of the reported cause. Callers swallow-and-log the
// envelope's rethrow instead.
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

// Response wrapper for an envelope-wrapped run (one that goes through
// runProgressStream). The envelope reports failures on-stream and closes
// before rethrowing, so the rethrow is swallowed-and-logged here — reaching
// the controller.error backstop would discard the queued error frame. This is
// the one place that invariant is enforced; envelope endpoints must use it.
export async function streamEnvelopeResponse (
  event: H3Event,
  label: string,
  run: (client: GraphQLClient, controller: ReadableStreamDefaultController) => Promise<unknown>,
) {
  return streamServerResponse(event, (client, controller) =>
    run(client, controller).catch(err => console.error(`${label} failed:`, err)))
}

// Wraps a bare phase run — one that takes emit/onError rather than a
// controller — in the shared envelope, for the standalone phase endpoints.
// The phase name becomes the stream's announced plan, so phase streams
// self-describe like full runs do.
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
