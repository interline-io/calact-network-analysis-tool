import { print } from 'graphql'

/**
 * GraphQL client implementations
 *
 */

/**
 * Interface for GraphQL client
 * Implementations should provide the actual GraphQL query execution
 */
export interface GraphQLClient {
  query<T = any>(query: any, variables?: any): Promise<{ data?: T }>
}

type fetcher = (url: string, options?: RequestInit) => Promise<Response>

/**
 * Real GraphQL client for testing with actual API calls
 */
export class BasicGraphQLClient implements GraphQLClient {
  private baseUrl: string
  private fetch: fetcher

  constructor (baseUrl: string, apiFetch: fetcher) {
    this.baseUrl = baseUrl
    this.fetch = apiFetch || fetch
  }

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    // Extract query string from DocumentNode or use as-is if string
    let queryString: string
    if (typeof query === 'string') {
      queryString = query
    } else {
      // Use graphql print function to convert DocumentNode to string
      queryString = print(query)
    }

    const requestBody = {
      query: queryString,
      variables,
    }
    // console.log('GraphQL request:', JSON.stringify(requestBody))

    try {
      const response = await this.fetch(this.baseUrl, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = await response.json()

      if (result.errors) {
        throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`)
      }
      return result
    } catch (error) {
      console.error('GraphQL request failed:', error)
      throw error
    }
  }
}

// Fetch function that adds API key header
export const apiFetch = (apikey: string) => (url: string, options: RequestInit = {}) => {
  return fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'apikey': apikey,
      ...options.headers
    }
  })
}
