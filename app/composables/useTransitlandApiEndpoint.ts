import type { H3Event } from 'h3'

export const useTransitlandApiEndpoint = (path?: string, event?: H3Event) => {
  const config = useRuntimeConfig(event)
  const apiBase = import.meta.server
    ? (config.tlv2?.proxyBase?.default)
    : (config.public.tlv2?.apiBase?.default || window?.location?.origin + '/api/v2')
  return apiBase + (path || '')
}
