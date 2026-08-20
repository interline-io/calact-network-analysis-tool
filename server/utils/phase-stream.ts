// Shared plumbing for the standalone scenario-phase endpoints: auth, GraphQL
// client construction, NDJSON headers, and the ready/complete/error envelope
// around a phase run. Mirrors the wire behavior of /api/scenario so phase
// streams feed the same ScenarioStreamReceiver/ScenarioDataReceiver.

import type { H3Event } from 'h3'
import { setHeader, sendStream } from 'h3'
import { requestStream, type GraphQLClient } from '~~/src/core'
import { createFailureReporter, ScenarioStreamSender, type ScenarioProgress } from '~~/src/scenario'
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
  run: (client: GraphQLClient, emit: (progress: ScenarioProgress) => void | Promise<void>, onError: (error: any) => void) => Promise<unknown>,
) {
  setStreamHeaders(event)
  const client = await buildServerGraphQLClient(event)

  const stream = new ReadableStream({
    async start (controller) {
      const writer = requestStream(controller).getWriter()
      const sender = new ScenarioStreamSender(writer)
      // Attributed to the last stage emitted, so reporting a failure doesn't
      // rewind the stage the loading modal is displaying.
      let lastStage: ScenarioProgress['currentStage'] = 'ready'
      const emit = (p: ScenarioProgress): Promise<void> => {
        lastStage = p.currentStage
        // Returned, not dropped. The phases await this to pace themselves
        // against the consumer; swallowing the promise turns every one of
        // those awaits into a no-op and puts these endpoints — which stream
        // the largest payloads of any — back on an unbounded write queue.
        return sender.onProgress(p)
      }
      emit({
        isLoading: true,
        currentStage: 'ready',
        currentStageMessage: startMessage,
      })
      const failures = createFailureReporter(client, emit, () => lastStage)
      try {
        await run(client, emit, failures.onError)
      } catch (err) {
        // Awaited before the close: writes are queued behind one another, so
        // closing first drops the event that says what went wrong.
        await sender.onError(err)
        await writer.close()
        return
      } finally {
        failures.dispose()
      }
      await sender.onComplete()
      await writer.close()
    }
  })

  return sendStream(event, stream)
}
