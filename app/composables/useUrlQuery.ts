import { navigateTo } from '#imports'

// Shared helper for the URL-backed composables. Merges new params over
// the current route query and strips null/undefined so removed values
// disappear from the URL. Use a single navigation per call so multiple
// keys set together don't race each other.
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

  return { setQuery }
}
