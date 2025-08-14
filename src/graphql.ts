import { print } from 'graphql'

/**
 * Interface for GraphQL client
 * Implementations should provide the actual GraphQL query execution
 */
export interface GraphQLClient {
  query<T = any>(query: any, variables?: any): Promise<{ data?: T }>
}

/**
 * Real GraphQL client for testing with actual API calls
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

    // Set up timeout using AbortController
    const controller = new AbortController()

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        signal: controller.signal
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
