// Shared plumbing for the standalone scenario-phase endpoints: auth, GraphQL
// client construction, NDJSON headers, and the ready/complete/error envelope
// around a phase run. Mirrors the wire behavior of /api/scenario so phase
// streams feed the same ScenarioStreamReceiver/ScenarioDataReceiver.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { ScenarioStreamSender, type ScenarioProgress } from '~~/src/scenario'
import { buildServerGraphQLClient } from './graphql-client'
import { compressStream } from './compress'

export function setNdjsonStreamHeaders (event: H3Event): void {
  setHeader(event, 'content-type', 'application/x-ndjson')
  setHeader(event, 'cache-control', 'no-cache')
  setHeader(event, 'connection', 'keep-alive')
}

export async function streamPhaseResponse (
  event: H3Event,
  startMessage: string,
  run: (client: GraphQLClient, emit: (progress: ScenarioProgress) => void, onError: (error: any) => void) => Promise<unknown>,
) {
  setNdjsonStreamHeaders(event)
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

  return sendStream(event, compressStream(event, stream))
}
