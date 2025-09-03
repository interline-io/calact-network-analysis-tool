// import { useAuthHeaders } from '#imports'

export const useApiFetch = async () => {
  // const headers = await useAuthHeaders()
  const headers: Record<string, string> = {}
  console.log('useApiFetch')
  headers['content-type'] = 'application/json'

  return (url: string, options: RequestInit = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    })
  }
}
