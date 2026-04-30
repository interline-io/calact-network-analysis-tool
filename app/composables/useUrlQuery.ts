import { navigateTo } from '#imports'

// Shared URL plumbing for the URL-backed composables. setQuery merges new
// params over the current route query and strips null/undefined so removed
// values disappear from the URL — one navigation per call so multiple keys
// set together don't race each other.
export function useUrlQuery () {
  const route = useRoute()

  function setQuery (params: Record<string, any>) {
    const merged: Record<string, any> = {}
    const source = { ...route.query, ...params }
    for (const k in source) {
      if (source[k] !== null && source[k] !== undefined) { merged[k] = source[k] }
    }
    return navigateTo({ replace: true, query: merged })
  }

  // CSV array param convention: missing → undefined (filter not applied),
  // explicitly empty → [] (all unchecked), otherwise → split comma list.
  function getArrayParam (key: string): string[] | undefined {
    if (!Object.prototype.hasOwnProperty.call(route.query, key)) {
      return undefined
    }
    const param = route.query[key]
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

  return { setQuery, getArrayParam, setArrayParam }
}
