import type { Router } from 'vue-router'
import { PendingQuery, querySource, type QuerySource } from './pendingQuery'

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

// The URL's query parameters.
export function useUrlQuery (): QuerySource {
  return querySource(pendingQueryFor(useRouter()))
}
