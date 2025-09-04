export const useTransitlandApiEndpoint = (path?: string) => {
  const config = useRuntimeConfig()
  console.log('config?', config, 'import.meta.server', import.meta.server)
  const apiBase = import.meta.server
    ? (config.tlv2?.proxyBase)
    : (config.public.tlv2?.apiBase || window?.location?.origin + '/api/v2')
  return apiBase + (path || '')
}
