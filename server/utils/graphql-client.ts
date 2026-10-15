// Per-request GraphQL client for streaming endpoints: the caller's Auth0
// access token when a session is present, the server API key otherwise.

import type { H3Event } from 'h3'
import { BasicGraphQLClient, apiFetch } from '~~/src/core'
import { resolveAccessToken } from './auth'

export async function buildServerGraphQLClient (event: H3Event): Promise<BasicGraphQLClient> {
  const token = await resolveAccessToken(event)
  const backend = useRuntimeConfig(event).tlv2proxy.backends.default
  return new BasicGraphQLClient(
    backend.base + '/query',
    apiFetch(backend.apikey, token),
  )
}
