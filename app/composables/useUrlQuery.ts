import type { Router } from 'vue-router'
import { PendingQuery } from './pendingQuery'

const pendingQueries = new WeakMap<Router, PendingQuery>()

// Shared URL plumbing for the URL-backed composables: read through `query`,
// write through setQuery. setQuery takes several keys at once, and writes in
// the same tick share one navigation, so keys set together can't race.
export function useUrlQuery () {
  const route = useRoute()
  const router = useRouter()
  let pendingQuery = pendingQueries.get(router)
  if (!pendingQuery) {
    pendingQuery = new PendingQuery(() => route.query, query => router.replace({ query }))
    pendingQueries.set(router, pendingQuery)
  }
  const pq = pendingQuery
  const query = pq.query

  function setQuery (params: Record<string, any>): Promise<void> {
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
