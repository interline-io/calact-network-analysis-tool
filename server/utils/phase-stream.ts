// Shared plumbing for the streaming endpoints: auth, GraphQL client
// construction, NDJSON headers, and the response-stream wrapper around a run.
// The ready/complete/error envelope itself is runProgressStream in
// src/scenario, shared with the CLI and in-process runs.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { runProgressStream, type ScenarioProgress } from '~~/src/scenario'
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

// Response wrapper for a run that streams NDJSON into the controller. The run
// (via runProgressStream) reports its own failures on the stream and closes
// it before rethrowing; the catch here is the backstop for anything thrown
// outside the envelope. A start() that resolves without closing or erroring
// the controller leaves the response open forever: the browser blocks on a
// read that never returns, under a loading modal it cannot dismiss. Erroring
// an already-closed controller is a no-op, so the normal path is unaffected.
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

// Wraps a bare phase run — one that takes emit/onError rather than a
// controller — in the shared envelope, for the standalone phase endpoints.
export async function streamPhaseResponse (
  event: H3Event,
  startMessage: string,
  run: (client: GraphQLClient, emit: (progress: ScenarioProgress) => void | Promise<void>, onError: (error: any) => void) => Promise<unknown>,
) {
  return streamServerResponse(event, (client, controller) =>
    runProgressStream(requestStream(controller), client, { startMessage },
      (emit, onError) => run(client, emit, onError)))
}
