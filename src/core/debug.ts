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
