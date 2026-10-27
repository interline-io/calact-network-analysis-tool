// The signed-in user's saved geographies (#477), kept in their Interline
// account through server/api/iwa/geographies. The list is shared for the
// session, so a save on the Query tab shows up in the picker and on the profile
// page without each fetching it again.

import {
  SAVED_GEOGRAPHY_ROLES,
  sortSavedGeographies,
  withFavorite,
  type SavedGeography,
  type SavedGeographyCreate,
  type SavedGeographyPermission,
  type SavedGeographyWithContent,
} from '~~/src/core'
import type { IwaMe } from '~~/server/api/iwa/me.get'

export type SavedGeographyAccess = Record<SavedGeographyPermission, boolean>

const NO_ACCESS: SavedGeographyAccess = { list: false, save: false, update: false, delete: false, download: false }

// A failed request's message: the server's statusMessage, which carries IWA's
// own explanation. Over HTTP/2 a response has no status text, so $fetch's own
// statusMessage is empty.
export function savedGeographyErrorMessage (e: unknown): string {
  const err = e as { statusCode?: number, statusMessage?: string, data?: { statusMessage?: string, message?: string } }
  return err.data?.statusMessage || err.data?.message || err.statusMessage || String(e)
}

export function useSavedGeographies () {
  const access = useState<SavedGeographyAccess | null>('cal-saved-geography-access', () => null)
  const geographies = useState<SavedGeography[] | null>('cal-saved-geographies', () => null)
  const loading = useState<boolean>('cal-saved-geographies-loading', () => false)
  const error = useState<string>('cal-saved-geographies-error', () => '')

  // What the user's plan allows, from their IWA roles. Without an Interline
  // account (or signed out, as in local development) it allows nothing.
  async function loadAccess (): Promise<SavedGeographyAccess> {
    if (access.value) {
      return access.value
    }
    try {
      const me = await $fetch<IwaMe>('/api/iwa/me')
      const roles = new Set(Object.values(me.roles || {}).flat())
      const allowed = { ...NO_ACCESS }
      for (const [permission, role] of Object.entries(SAVED_GEOGRAPHY_ROLES)) {
        allowed[permission as SavedGeographyPermission] = roles.has(role)
      }
      access.value = allowed
    } catch (e) {
      console.warn('[saved-geographies] No Interline account access:', savedGeographyErrorMessage(e))
      access.value = { ...NO_ACCESS }
    }
    return access.value
  }

  async function refresh () {
    loading.value = true
    error.value = ''
    try {
      const resp = await $fetch<{ geographies: SavedGeography[] }>('/api/iwa/geographies')
      geographies.value = sortSavedGeographies(resp.geographies)
    } catch (e) {
      error.value = savedGeographyErrorMessage(e)
    } finally {
      loading.value = false
    }
  }

  // Loads the list once per session, if the plan allows listing
  async function ensureLoaded () {
    const allowed = await loadAccess()
    if (allowed.list && geographies.value === null && !loading.value) {
      await refresh()
    }
  }

  function replace (saved: SavedGeography) {
    const others = (geographies.value || []).filter(g => g.id !== saved.id)
    geographies.value = sortSavedGeographies([...others, saved])
  }

  async function create (body: SavedGeographyCreate): Promise<SavedGeography> {
    const saved = await $fetch<SavedGeography>('/api/iwa/geographies', { method: 'POST', body })
    replace(saved)
    return saved
  }

  async function get (id: string): Promise<SavedGeographyWithContent> {
    return await $fetch<SavedGeographyWithContent>(`/api/iwa/geographies/${encodeURIComponent(id)}`)
  }

  async function rename (g: SavedGeography, name: string): Promise<SavedGeography> {
    const saved = await $fetch<SavedGeography>(`/api/iwa/geographies/${encodeURIComponent(g.id)}`, { method: 'PATCH', body: { name } })
    replace(saved)
    return saved
  }

  async function setFavorite (g: SavedGeography, favorite: boolean): Promise<SavedGeography> {
    const metadata = withFavorite(g.metadata, favorite)
    const saved = await $fetch<SavedGeography>(`/api/iwa/geographies/${encodeURIComponent(g.id)}`, { method: 'PATCH', body: { metadata } })
    replace(saved)
    return saved
  }

  async function remove (g: SavedGeography) {
    await $fetch(`/api/iwa/geographies/${encodeURIComponent(g.id)}`, { method: 'DELETE' })
    geographies.value = (geographies.value || []).filter(other => other.id !== g.id)
  }

  return { access, geographies, loading, error, loadAccess, refresh, ensureLoaded, create, get, rename, setFavorite, remove }
}
