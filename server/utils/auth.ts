import type { H3Event } from 'h3'
import { createError } from 'h3'

/**
 * Resolve the Auth0 access token for an incoming request, honoring the
 * public `requireLogin` runtime flag.
 *
 * Behavior:
 * - If a session is present, returns its access token. If token retrieval
 *   throws and `requireLogin` is true, raises 401; otherwise returns undefined.
 * - If no session is present and `requireLogin` is true, raises 401.
 * - If no session is present and `requireLogin` is false, returns undefined —
 *   downstream code falls back to the server's default API key (the same
 *   posture as the /api/proxy route in tlv2-auth).
 */
export async function resolveAccessToken (event: H3Event): Promise<string | undefined> {
  const requireLogin = useRuntimeConfig(event).public.tlv2.requireLogin
  if (event.context.auth0Session) {
    try {
      return await event.context.auth0Session.getAccessToken()
    } catch {
      if (requireLogin) {
        throw createError({ statusCode: 401, statusMessage: 'Session expired, please log in again' })
      }
      return undefined
    }
  }
  if (requireLogin) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return undefined
}
