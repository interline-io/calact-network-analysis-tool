import { print } from 'graphql'

/**
 * GraphQL client implementations
 *
 * This file contains two approaches for GraphQL access:
 *
 * 1. BasicGraphQLClient - Direct API access for CLI tools, tests, and non-Nuxt contexts
 *    - Uses environment variables: TRANSITLAND_API_ENDPOINT, TRANSITLAND_API_KEY
 *    - Suitable for scripts, CLI tools, and testing
 *
 * 2. useGraphQLClientOnBackend - Proxy-based access for Nuxt server endpoints
 *    - Uses user JWT tokens through the proxy system
 *    - Suitable for authenticated web endpoints
 */

/**
 * Interface for GraphQL client
 * Implementations should provide the actual GraphQL query execution
 */
export interface GraphQLClient {
  query<T = any>(query: any, variables?: any): Promise<{ data?: T }>
}

/**
 * Real GraphQL client for testing with actual API calls
 * Use this for CLI tools, tests, and other non-Nuxt contexts
 * For Nuxt server endpoints, use useGraphQLClientOnBackend instead
 */
export class BasicGraphQLClient implements GraphQLClient {
  private baseUrl: string
  private apiKey: string

  constructor (baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
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

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': this.apiKey
    }

    const requestBody = {
      query: queryString,
      variables,
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
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

/**
 * Factory function to create a GraphQL client for server-side use
 * Uses environment variables for configuration
 * Use this for CLI tools, tests, and other non-Nuxt contexts
 * For Nuxt server endpoints, use useGraphQLClientOnBackend instead
 */
export function createGraphQLClient (): GraphQLClient {
  const baseUrl = process.env.TRANSITLAND_API_URL || 'https://api.transit.land/v2/graphql'
  const apiKey = process.env.TRANSITLAND_API_KEY || ''

  if (!apiKey) {
    console.warn('TRANSITLAND_API_KEY environment variable not set')
  }

  return new BasicGraphQLClient(baseUrl, apiKey)
}
