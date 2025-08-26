import { vi, type Mock } from 'vitest'
import type { GraphQLClient } from './graphql'

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
