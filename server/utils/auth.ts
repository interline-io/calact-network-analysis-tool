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
  // Default to the secure posture if the flag is missing or falsy-but-not-false
  // (e.g. an empty NUXT_PUBLIC_TLV2_REQUIRE_LOGIN env var). Only an explicit
  // `false` should relax the 401.
  const requireLogin = useRuntimeConfig(event).public.tlv2.requireLogin ?? true
  if (event.context.auth0Session) {
    try {
      return await event.context.auth0Session.getAccessToken()
    } catch (err) {
      if (requireLogin) {
        throw createError({ statusCode: 401, statusMessage: 'Session expired, please log in again' })
      }
      console.warn('[auth] getAccessToken failed; falling back to apikey-only auth (requireLogin=false):', err)
      return undefined
    }
  }
  if (requireLogin) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return undefined
}
