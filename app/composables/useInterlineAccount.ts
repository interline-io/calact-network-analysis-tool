// The user's account page in the Interline Web App, which shows what's beyond
// this app: their plan, other Interline products, and everything they've stored
export function useInterlineAccountUrl (tab?: 'assets'): string {
  const base = useRuntimeConfig().public.iwaBaseUrl
  return tab ? `${base}/users/me?tab=${tab}` : `${base}/users/me`
}
