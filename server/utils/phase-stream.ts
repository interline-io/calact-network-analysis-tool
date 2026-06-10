// Shared plumbing for the standalone scenario-phase endpoints: auth, GraphQL
// client construction, NDJSON headers, and the ready/complete/error envelope
// around a phase run. Mirrors the wire behavior of /api/scenario so phase
// streams feed the same ScenarioStreamReceiver/ScenarioDataReceiver.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { ScenarioStreamSender, type ScenarioProgress } from '~~/src/scenario'
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

export async function streamPhaseResponse (
  event: H3Event,
  startMessage: string,
  run: (client: GraphQLClient, emit: (progress: ScenarioProgress) => void, onError: (error: any) => void) => Promise<unknown>,
) {
  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  const stream = new ReadableStream({
    async start (controller) {
      const writer = requestStream(controller).getWriter()
      const sender = new ScenarioStreamSender(writer)
      sender.onProgress({
        isLoading: true,
        currentStage: 'ready',
        currentStageMessage: startMessage,
      })
      try {
        await run(client, p => sender.onProgress(p), e => sender.onError(e))
      } catch (err) {
        sender.onError(err)
        writer.close()
        return
      }
      sender.onComplete()
      writer.close()
    }
  })

  return sendStream(event, stream)
}
