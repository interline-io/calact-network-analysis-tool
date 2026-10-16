// Runs one endpoint's stream run off the main thread for direct mode, and
// relays its NDJSON back to the page.
//
// TODO: before direct mode ships, move the flex phase's turf area calls (flex
// area sizes) to PostGIS. Here they run in the browser, which the project's
// geometry rule forbids.

import { BasicGraphQLClient, postStream, producerStream } from '~~/src/core'
import { streamRuns, type StreamEndpoint } from '~~/src/stream-runs'

// What the page posts to start a run.
export interface StreamRunRequest {
  endpoint: StreamEndpoint
  // The JSON request body, in the form the BFF reads.
  body: string
  graphqlUrl: string
}

self.onmessage = (event: MessageEvent<StreamRunRequest>) => {
  const { endpoint, body, graphqlUrl } = event.data
  // The proxy adds the API credentials from the session.
  // TODO: before direct mode ships, use apiFetch here. This copy drops any
  // headers the client passes, where apiFetch merges them.
  const client = new BasicGraphQLClient(graphqlUrl, (url, options) => fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json' },
  }))
  const run = streamRuns[endpoint]
  postStream(
    producerStream(controller => run(JSON.parse(body), client, controller)),
    (message, transfer) => self.postMessage(message, { transfer }),
  )
}
