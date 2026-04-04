import type { H3Event } from 'h3'

export const useApiFetch = async (event?: H3Event) => {
  const headers: Record<string, string> = {}
  headers['content-type'] = 'application/json'

  if (import.meta.server && event) {
    // Server-side: use graphql API key for backend access
    const config = useRuntimeConfig(event)
    const apikey = config.tlv2?.graphqlApikey
    if (apikey) {
      headers['apikey'] = apikey
    }
    // Forward user's access token from auth0 session if available
    const session = event.context.auth0Session
    if (session) {
      try {
        const accessToken = await session.getAccessToken()
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`
        }
      } catch {
        // No auth token available, will use apikey only
      }
    }
  }

  // Client-side: no explicit auth headers needed — session cookie is sent
  // automatically by the browser, and CSRF token is added by tlv2-auth's plugin.

  return (url: string, options: RequestInit = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    })
  }
}
