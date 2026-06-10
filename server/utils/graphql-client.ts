// Per-request GraphQL client for streaming endpoints: the caller's Auth0
// access token when a session is present, the server API key otherwise.

import type { H3Event } from 'h3'
import { BasicGraphQLClient, apiFetch } from '~~/src/core'
import { resolveAccessToken } from './auth'

export async function buildServerGraphQLClient (event: H3Event): Promise<BasicGraphQLClient> {
  const token = await resolveAccessToken(event)
  const runtimeConfig = useRuntimeConfig(event)
  return new BasicGraphQLClient(
    runtimeConfig.tlv2.proxyBase.default + '/query',
    apiFetch(runtimeConfig.tlv2?.graphqlApikey || '', token),
  )
}
