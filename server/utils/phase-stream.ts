// Shared plumbing for the streaming endpoints: NDJSON headers, and serving a
// stream run with the caller's GraphQL client.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { producerStream } from '~~/src/core'
import { streamRuns, type StreamEndpoint } from '~~/src/stream-runs'
import { buildServerGraphQLClient } from './graphql-client'

// NDJSON stream headers, typed application/json: the edge only compresses
// content types on its default list, which excludes application/x-ndjson,
// and our consumers never sniff the type.
function setStreamHeaders (event: H3Event): void {
  setHeader(event, 'content-type', 'application/json; charset=utf-8')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')
}

// Responds with an endpoint's stream run over a validated request body.
export async function serveStreamRun (event: H3Event, endpoint: StreamEndpoint, body: unknown) {
  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)
  const run = streamRuns[endpoint]
  return sendStream(event, producerStream(controller => run(body, client, controller)))
}
