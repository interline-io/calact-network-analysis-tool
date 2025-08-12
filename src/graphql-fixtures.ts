import { vi, type Mock } from 'vitest'
import { print } from 'graphql'
import type { GraphQLClient } from './scenario'

/**
 * Real GraphQL client for testing with actual API calls
 */
export class TestGraphQLClient implements GraphQLClient {
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
 * Mock GraphQL client for testing without real API calls
 */
export class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock

  constructor () {
    this.mockQuery = vi.fn()
  }

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}
