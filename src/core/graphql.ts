import { print } from 'graphql'

/**
 * GraphQL client implementations
 *
 */

// Whether per-request tracing is on (`TL_LOG=trace`). Server-side and CLI only —
// in the browser, use the network panel.
function traceEnabled (): boolean {
  return process.env.TL_LOG === 'trace'
}

interface Trace {
  operation: string
  query: string
  variables?: unknown
  elapsedMs: number
  // Attempts consumed, including the one being traced.
  attempts: number
  error?: unknown
}

// Label for a traced request. Skips past any leading fragment definitions —
// several documents colocate one, and a fragment has a name of its own that
// would otherwise be mistaken for the operation's.
function operationLabel (query: any): string {
  const op = (query?.definitions || []).find((d: any) => d?.kind === 'OperationDefinition')
  if (op?.name?.value) {
    return op.name.value
  }
  // Fallback for a query passed as a string, or one left unnamed.
  const fields: string[] = (op?.selectionSet?.selections || [])
    .map((s: any) => s?.name?.value)
    .filter(Boolean)
  return fields.length > 0 ? fields.join(',') : 'query'
}

// A summary line followed by the full request: the query as sent and every
// variable, unabridged. Nothing is elided — a variable list you can't read in
// full is a variable list you can't reproduce the request from.
function logTrace (t: Trace): void {
  const retried = t.attempts > 1 ? ` retries=${t.attempts - 1}` : ''
  const status = t.error ? ` FAILED: ${t.error}` : ''
  console.log(`[GQL ${t.operation}] ${t.elapsedMs}ms${retried}${status}`)
  console.log(t.query.trim())
  // Compact, not pretty-printed: a 1000-element id array would otherwise take
  // 1000 lines and bury the query above it.
  console.log(`variables: ${JSON.stringify(t.variables ?? {})}`)
}

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
  private maxRetries: number
  private retryDelay: number

  constructor (baseUrl: string, apiFetch: fetcher, options?: { maxRetries?: number, retryDelay?: number }) {
    this.baseUrl = baseUrl
    this.fetch = apiFetch || fetch
    this.maxRetries = options?.maxRetries ?? 3 // Default to 3 retries
    this.retryDelay = options?.retryDelay ?? 1000 // 1 second default delay
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

    const trace = traceEnabled()

    let lastError: Error | null = null
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      // Per attempt, so a traced time is the request's own, not the sum of
      // earlier attempts and the retry sleeps between them.
      const startedAt = trace ? Date.now() : 0
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
        if (trace) {
          logTrace({
            operation: operationLabel(query),
            query: queryString,
            variables,
            elapsedMs: Date.now() - startedAt,
            attempts: attempt + 1,
          })
        }
        return result
      } catch (error) {
        lastError = error as Error

        // Don't retry on the last attempt
        if (attempt < this.maxRetries) {
          console.warn(`GraphQL request failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${this.retryDelay}ms:`, error)
          await this.delay(this.retryDelay)
        } else {
          if (trace) {
            logTrace({
              operation: operationLabel(query),
              query: queryString,
              variables,
              elapsedMs: Date.now() - startedAt,
              attempts: attempt + 1,
              error,
            })
          }
          console.error('GraphQL request failed after all retry attempts:', error)
        }
      }
    }

    throw lastError
  }

  private delay (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// Fetch function that adds API key and optional auth token headers
export const apiFetch = (apikey: string, token?: string) => (url: string, options: RequestInit = {}) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...options.headers as Record<string, string>,
  }
  if (apikey) { headers.apikey = apikey }
  if (token) { headers.Authorization = `Bearer ${token}` }
  return fetch(url, { ...options, headers })
}
