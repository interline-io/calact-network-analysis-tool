// The signed-in user's Interline Web App account, fetched from IWA's
// /user_api/me with their Auth0 access token. /admin/profile uses it to check
// that IWA accepts this app's tokens, and the app reads its roles to offer
// saved geographies.

import { iwaFetch } from '~~/server/utils/iwa'

export interface IwaMe {
  id: number
  email: string
  name: string
  // Gatekeeper roles, by IWA product
  roles: Record<string, string[]>
}

export default defineEventHandler(async (event): Promise<IwaMe> => {
  return await iwaFetch<IwaMe>(event, '/me')
})
