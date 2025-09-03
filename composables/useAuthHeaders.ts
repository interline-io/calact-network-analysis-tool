import { checkToken } from 'tlv2-ui/lib'
// import { useCsrf } from '#imports'

// Headers, including CSRF
export const useAuthHeaders2 = async () => {
  const config = useRuntimeConfig()
  const headers: Record<string, string> = {}

  // CSRF
  // if (config.public.tlv2?.useProxy) {
  //   const { headerName: csrfHeader, csrf: csrfToken } = useCsrf()
  //   headers[csrfHeader] = csrfToken
  // }

  // JWT
  const { token } = await checkToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Api key
  if (import.meta.server && config.tlv2?.graphqlApikey) {
    headers['apikey'] = config.tlv2?.graphqlApikey
  }

  // debugLog('useAuthHeaders:', headers)
  return headers
}
