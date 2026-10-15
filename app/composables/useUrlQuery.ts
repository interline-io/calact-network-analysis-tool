import type { Router } from 'vue-router'
import { PendingQuery, type QueryValue } from './pendingQuery'

const pendingQueries = new WeakMap<Router, PendingQuery>()

// One PendingQuery per app, shared by every caller. It reads the router's
// current route rather than useRoute(): inside a page, useRoute() is that
// page's own route, which stops updating once the page unmounts, so a query
// cached from it would read a stale URL after leaving and coming back.
function pendingQueryFor (router: Router): PendingQuery {
  let pq = pendingQueries.get(router)
  if (!pq) {
    const created = new PendingQuery(() => router.currentRoute.value.query, query => router.replace({ query }))
    // Back and forward restore a history entry; writes that hadn't reached
    // the URL yet must not be laid over it, or written into it.
    window.addEventListener('popstate', () => created.discard())
    pendingQueries.set(router, created)
    pq = created
  }
  return pq
}

// Shared URL plumbing for the URL-backed composables: read through `query`,
// write through setQuery. setQuery takes several keys at once, and writes in
// the same tick share one navigation, so keys set together can't race.
export function useUrlQuery () {
  const pq = pendingQueryFor(useRouter())
  const query = pq.query

  // Values are strings (or string arrays), as the URL holds them, so a write
  // reads back exactly as it will once it lands. null and undefined remove
  // the key.
  function setQuery (params: Record<string, QueryValue>): Promise<void> {
    return pq.set(params)
  }

  // CSV array param convention: missing → undefined (filter not applied),
  // explicitly empty → [] (all unchecked), otherwise → split comma list.
  function getArrayParam (key: string): string[] | undefined {
    if (!Object.prototype.hasOwnProperty.call(query.value, key)) {
      return undefined
    }
    const param = query.value[key]
    if (!param) {
      return []
    }
    return param.toString().split(',').filter(Boolean)
  }

  function setArrayParam (key: string, v: string[] | undefined) {
    if (v === undefined) {
      setQuery({ [key]: undefined })
    } else if (v.length === 0) {
      setQuery({ [key]: '' })
    } else {
      setQuery({ [key]: v.join(',') })
    }
  }

  return { query, setQuery, getArrayParam, setArrayParam }
}
