// Opens the NDJSON stream of an endpoint's run. In 'bff' mode the browser
// reads the BFF endpoint's response; in 'direct' mode a worker runs the
// endpoint's entry in src/stream-runs.ts off the main thread and sends its
// GraphQL requests through the API proxy.

import { toValue, type MaybeRefOrGetter } from 'vue'
import { useApiEndpoint } from '#imports'
import { withCalendarDates, workerStream } from '~~/src/core'
import type { StreamEndpoint } from '~~/src/stream-runs'
import type { StreamRunRequest } from '../workers/stream-run.worker'

// Where a run's GraphQL requests come from: the BFF, or the browser.
export type FetchMode = 'bff' | 'direct'

// Opens one run's stream. Aborting `signal` cancels the run.
export type OpenStream = (endpoint: StreamEndpoint, body: unknown, signal?: AbortSignal) => Promise<ReadableStream<Uint8Array>>

export function useOpenStream (fetchMode: MaybeRefOrGetter<FetchMode>): OpenStream {
  // Resolved now: it reads runtime config, which needs the setup context.
  const graphqlUrl = useApiEndpoint('/query', 'default')

  return async (endpoint, body, signal) => {
    // The body as the BFF reads it, so both modes run on the same input.
    const json = JSON.stringify(withCalendarDates(body))

    if (toValue(fetchMode) === 'direct') {
      // One worker per run; Vite bundles the worker from this exact form.
      const worker = new Worker(new URL('../workers/stream-run.worker.ts', import.meta.url), { type: 'module' })
      const request: StreamRunRequest = { endpoint, body: json, graphqlUrl }
      return workerStream(worker, request, signal)
    }

    const url = `/api/${endpoint}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
      signal,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`)
    }
    if (!response.body) {
      throw new Error(`No response body from ${url}`)
    }
    return response.body
  }
}
