// The signed-in user's Interline Web App account, fetched from IWA's
// /user_api/me with their Auth0 access token. /admin/profile uses it to check
// that IWA accepts this app's tokens, ahead of features that store data in IWA.

import { createError } from 'h3'
import { resolveAccessToken } from '~~/server/utils/auth'

// The parts of $fetch's FetchError used here
interface IwaFetchError {
  response?: { status: number, statusText: string }
  data?: { error?: string, message?: string }
}

export interface IwaMe {
  id: number
  email: string
  name: string
  // Gatekeeper roles, by IWA product
  roles: Record<string, string[]>
}

export default defineEventHandler(async (event): Promise<IwaMe> => {
  const token = await resolveAccessToken(event)
  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in to check your Interline account' })
  }

  const base = useRuntimeConfig(event).iwaBaseUrl
  try {
    return await $fetch<IwaMe>(`${base}/user_api/me`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10_000,
    })
  } catch (err) {
    // Pass IWA's own error code and message along (invalid_token,
    // unknown_user, account_disabled, ...), since they say what to fix
    const { response, data } = err as IwaFetchError
    if (response) {
      throw createError({
        statusCode: response.status,
        statusMessage: data?.message ?? response.statusText,
        data: { error: data?.error },
      })
    }
    throw createError({ statusCode: 502, statusMessage: `Couldn't reach IWA at ${base}` })
  }
})
