import { useAuthHeaders2 } from './useAuthHeaders'

export const useApiFetch = async () => {
  const headers = await useAuthHeaders2()
  headers['content-type'] = 'application/json'
  console.log('useApiFetch', headers)

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
