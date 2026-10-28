// Calls to the Interline Web App's /user_api, as the signed-in user: their
// Auth0 access token is the Bearer token (interline-web-app#785).

import type { H3Event } from 'h3'
import { createError } from 'h3'
import { resolveAccessToken } from '~~/server/utils/auth'

// The parts of $fetch's FetchError used here
interface IwaFetchError {
  response?: { status: number, statusText: string }
  data?: { error?: string, message?: string }
}

type IwaFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | undefined>
  body?: object
}

// Fetches an IWA /user_api path (e.g. `/me`) for the request's user. Throws an
// H3 error carrying IWA's own error code and message (invalid_token,
// not_entitled, content_too_large, ...), since they say what to fix.
export async function iwaFetch<T> (event: H3Event, path: string, opts: IwaFetchOptions = {}): Promise<T> {
  const token = await resolveAccessToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to use your Interline account' })
  }

  const base = useRuntimeConfig(event).iwaBaseUrl
  const url = `${base}/user_api${path}`
  try {
    return await $fetch<T>(url, {
      method: opts.method ?? 'GET',
      query: opts.query,
      body: opts.body,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30_000,
    })
  } catch (err) {
    const { response, data } = err as IwaFetchError
    if (response) {
      console.warn(`[iwa] ${opts.method ?? 'GET'} ${path} returned ${response.status} ${data?.error ?? ''}: ${data?.message ?? ''}`)
      throw createError({
        statusCode: response.status,
        statusMessage: data?.message ?? response.statusText,
        data: { error: data?.error },
      })
    }
    console.warn(`[iwa] Couldn't reach ${url}:`, err)
    throw createError({ statusCode: 502, statusMessage: `Couldn't reach Interline at ${base}` })
  }
}
