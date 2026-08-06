/**
 * Debug utilities for memory profiling and diagnostics
 */

/**
 * Log memory usage with a label. Only logs when DEBUG_MEMORY env var is set.
 * Reports both heap usage and RSS (resident set size).
 */
export function logMemory (label: string): void {
  if (process.env.DEBUG_MEMORY) {
    const usage = process.memoryUsage()
    const heapMB = (usage.heapUsed / 1024 / 1024).toFixed(1)
    const rssMB = (usage.rss / 1024 / 1024).toFixed(1)
    console.log(`[MEM ${label}] heap: ${heapMB}MB, rss: ${rssMB}MB`)
  }
}

// Whether per-query GraphQL tracing is on (`TL_LOG=trace`). Server-side only —
// in the browser, use the network panel.
export function graphqlTraceEnabled (): boolean {
  return process.env.TL_LOG === 'trace'
}

export interface GraphqlTrace {
  // Operation name, or the root field names when the document is anonymous.
  operation: string
  query: string
  variables?: unknown
  elapsedMs: number
  // Attempts consumed, including the one being traced.
  attempts: number
  error?: unknown
}

// A summary line followed by the full request: the query as sent and every
// variable, unabridged. Nothing is elided — a variable list you can't read in
// full is a variable list you can't reproduce the request from.
export function logGraphqlTrace (t: GraphqlTrace): void {
  const retried = t.attempts > 1 ? ` retries=${t.attempts - 1}` : ''
  const status = t.error ? ` FAILED: ${t.error}` : ''
  console.log(`[GQL ${t.operation}] ${t.elapsedMs}ms${retried}${status}`)
  console.log(t.query.trim())
  // Compact, not pretty-printed: a 1000-element id array would otherwise take
  // 1000 lines and bury the query above it.
  console.log(`variables: ${JSON.stringify(t.variables ?? {})}`)
}
