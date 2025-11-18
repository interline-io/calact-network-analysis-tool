import { Auth0Client } from '@auth0/auth0-spa-js'
import type { H3Event } from 'h3'

export const useApiFetch = async (event?: H3Event) => {
  const headers: Record<string, string> = {}
  headers['content-type'] = 'application/json'
  if (import.meta.server) {
    if (event) {
      headers['Authorization'] = getHeader(event, 'Authorization') || ''
    }
  } else {
    const { token } = await checkToken()
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }
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

async function checkToken () {
  let token = ''
  let loggedIn = false
  let mustReauthorize = false

  // Create and return global auth0 client
  const config = useRuntimeConfig()
  const options = config.public.tlv2
  const client = new Auth0Client({
    domain: String(options.auth0Domain),
    clientId: String(options.auth0ClientId),
    cacheLocation: 'localstorage',
    useRefreshTokens: false, // Use iframe method for token refresh
    authorizationParams: {
      redirect_uri: String(options.auth0RedirectUri || window?.location?.origin || '/'),
      audience: String(options.auth0Audience),
      scope: String(options.auth0Scope)
    }
  })
  try {
    // First check if we're authenticated
    loggedIn = await client.isAuthenticated()
    if (!loggedIn) {
      return { token, loggedIn, mustReauthorize }
    }

    // Get a fresh token
    const tokenResponse = await client.getTokenSilently({ detailedResponse: true })
    token = tokenResponse.access_token
    loggedIn = true
  } catch (error: any) {
    if (error.error === 'login_required') {
      mustReauthorize = true
    }
  }
  return { token, loggedIn, mustReauthorize }
}
