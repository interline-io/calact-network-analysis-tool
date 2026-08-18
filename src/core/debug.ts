/**
 * Debug utilities for memory profiling and diagnostics
 */

/**
 * Log memory usage with a label. Only logs when DEBUG_MEMORY env var is set.
 * Reports both heap usage and RSS (resident set size).
 *
 * Run node with `--expose-gc` to collect first: without it the reading counts
 * whatever garbage V8 has not got round to yet, which on a phase that churns
 * through millions of short-lived objects is most of the number.
 */
export function logMemory (label: string): void {
  if (process.env.DEBUG_MEMORY) {
    globalThis.gc?.()
    const usage = process.memoryUsage()
    const heapMB = (usage.heapUsed / 1024 / 1024).toFixed(1)
    const rssMB = (usage.rss / 1024 / 1024).toFixed(1)
    console.log(`[MEM ${label}] heap: ${heapMB}MB, rss: ${rssMB}MB`)
  }
}
