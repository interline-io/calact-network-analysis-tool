/**
 * Simplified streaming scenario implementation
 * Separates fetching from accumulation for better architecture
 */

import type { StopGql } from '~/src/stop'
import type { RouteGql } from '~/src/route'
import type { AgencyGql } from '~/src/agency'
import type { ScenarioConfig, ScenarioData, ScenarioProgress, ScenarioCallbacks } from '~/src/scenario'
import { StopDepartureCache } from '~/src/departure-cache'

// Re-export types for external consumption
export type { StopGql, RouteGql, AgencyGql, ScenarioConfig, ScenarioProgress, ScenarioData }

// ============================================================================
// SCENARIO DATA RECEIVER - Core accumulation logic
// ============================================================================

/**
 * Receives progress events and accumulates ScenarioData
 * This is the core logic used by both in-process and streaming scenarios
 */
export class ScenarioDataReceiver {
  private accumulatedData: ScenarioData
  private callbacks: ScenarioCallbacks

  constructor (callbacks: ScenarioCallbacks = {}) {
    this.callbacks = callbacks
    this.accumulatedData = {
      stops: [],
      routes: [],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: false
    }
  }

  /**
   * Handle a progress event from ScenarioFetcher
   */
  onProgress (progress: ScenarioProgress): void {
    // If progress contains partial data, accumulate it
    if (progress.partialData) {
      // Append new stops
      if (progress.partialData.stops.length > 0) {
        this.accumulatedData.stops.push(...progress.partialData.stops)
      }

      // Append new routes
      if (progress.partialData.routes.length > 0) {
        this.accumulatedData.routes.push(...progress.partialData.routes)
      }

      // Append new feed versions
      if (progress.partialData.feedVersions.length > 0) {
        this.accumulatedData.feedVersions.push(...progress.partialData.feedVersions)
      }
    }

    // Forward progress to callback
    this.callbacks.onProgress?.(progress)
  }

  /**
   * Handle completion from ScenarioFetcher
   */
  onComplete (finalData: ScenarioData): void {
    // Use the final data if provided, otherwise use accumulated data
    this.accumulatedData = {
      ...finalData,
      isComplete: true
    }

    this.callbacks.onComplete?.(this.accumulatedData)
  }

  /**
   * Handle error from ScenarioFetcher
   */
  onError (error: any): void {
    this.callbacks.onError?.(error)
  }

  /**
   * Get the current accumulated data
   */
  getCurrentData (): ScenarioData {
    return { ...this.accumulatedData }
  }
}

// ============================================================================
// IN-PROCESS SCENARIO FETCHER
// ============================================================================

/**
 * Fetch scenario data in-process using ScenarioFetcher + ScenarioDataReceiver
 */
export async function fetchScenario (
  config: ScenarioConfig,
  callbacks: ScenarioCallbacks = {}
): Promise<ScenarioData> {
  // Import ScenarioFetcher here to avoid circular dependencies
  const { ScenarioFetcher } = await import('~/src/scenario')
  const { BasicGraphQLClient } = await import('~/src/graphql')

  // Create GraphQL client
  const client = new BasicGraphQLClient(
    process.env.TRANSITLAND_API_ENDPOINT || 'https://transit.land/api/v2/query',
    process.env.TRANSITLAND_API_KEY || 'test-key'
  )

  // Create receiver to accumulate data
  const receiver = new ScenarioDataReceiver(callbacks)

  // Create fetcher with receiver callbacks
  const fetcher = new ScenarioFetcher(config, client, {
    onProgress: progress => receiver.onProgress(progress),
    onComplete: result => receiver.onComplete(result),
    onError: error => receiver.onError(error)
  })

  // Fetch and return result
  return await fetcher.fetch()
}

// ============================================================================
// STREAMING MESSAGE TYPES (Internal to streaming implementation)
// ============================================================================

// Internal message types that mirror ScenarioProgress events
interface StreamingProgressMessage {
  type: 'progress'
  data: ScenarioProgress
}

interface StreamingCompleteMessage {
  type: 'complete'
  data: ScenarioData
}

interface StreamingErrorMessage {
  type: 'error'
  data: { message: string, phase?: string }
}

type StreamingMessage = StreamingProgressMessage | StreamingCompleteMessage | StreamingErrorMessage

// ============================================================================
// STREAMING CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Streaming client receives messages from server and uses ScenarioDataReceiver
 */
export class StreamingScenarioClient {
  private abortController: AbortController | null = null

  /**
   * Fetch scenario data using streaming from server
   */
  async fetchScenario (
    config: ScenarioConfig,
    callbacks: ScenarioCallbacks = {}
  ): Promise<ScenarioData> {
    // Cancel any existing request
    if (this.abortController) {
      this.abortController.abort()
    }

    this.abortController = new AbortController()

    // Validate config
    if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      throw new Error('Either bbox or geographyIds must be provided')
    }

    // Create receiver to accumulate data from streaming messages
    const receiver = new ScenarioDataReceiver(callbacks)

    try {
      const response = await fetch('/api/scenario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config),
        signal: this.abortController.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('Response body is not readable')
      }

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const message = JSON.parse(line) as StreamingMessage

            if (message.type === 'progress') {
              receiver.onProgress(message.data)
            } else if (message.type === 'complete') {
              receiver.onComplete(message.data)
              return receiver.getCurrentData()
            } else if (message.type === 'error') {
              const error = new Error(message.data.message)
              receiver.onError(error)
              throw error
            }
          } catch (parseError) {
            console.warn('Failed to parse streaming message:', line, parseError)
            // Continue processing other messages rather than failing completely
          }
        }
      }

      // Return current accumulated data if stream ended without completion
      return receiver.getCurrentData()
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request was cancelled')
      }
      receiver.onError(error)
      throw error
    }
  }

  /**
   * Cancel the current request
   */
  cancel (): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Check if a request is currently in progress
   */
  get isLoading (): boolean {
    return this.abortController !== null
  }
}

// ============================================================================
// STREAMING SERVER IMPLEMENTATION
// ============================================================================

/**
 * Server-side streaming sender
 * Converts ScenarioFetcher progress events to JSON messages over the wire
 */
export async function processStreamingScenario (
  config: ScenarioConfig,
  sendMessage: (message: StreamingMessage) => void
): Promise<void> {
  try {
    // Import ScenarioFetcher and GraphQLClient here to avoid circular dependencies
    const { ScenarioFetcher } = await import('~/src/scenario')
    const { BasicGraphQLClient } = await import('~/src/graphql')

    // Create GraphQL client
    const client = new BasicGraphQLClient(
      process.env.TRANSITLAND_API_ENDPOINT || 'https://transit.land/api/v2/query',
      process.env.TRANSITLAND_API_KEY || 'test-key'
    )

    // Create ScenarioFetcher with streaming message sender
    const scenarioFetcher = new ScenarioFetcher(config, client, {
      onProgress: (progress) => {
        const message: StreamingProgressMessage = {
          type: 'progress',
          data: progress
        }
        sendMessage(message)
      },
      onComplete: (result) => {
        const message: StreamingCompleteMessage = {
          type: 'complete',
          data: result
        }
        sendMessage(message)
      },
      onError: (error) => {
        console.error('ScenarioFetcher error:', error)
        const message: StreamingErrorMessage = {
          type: 'error',
          data: { message: error.message || 'Unknown error in ScenarioFetcher' }
        }
        sendMessage(message)
      }
    })

    // Start the scenario fetching process
    await scenarioFetcher.fetch()
  } catch (error) {
    console.error('Error in processStreamingScenario:', error)
    const message: StreamingErrorMessage = {
      type: 'error',
      data: { message: error instanceof Error ? error.message : 'Unknown error' }
    }
    sendMessage(message)
    throw error
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convenience function to create a new streaming client and fetch scenario
 */
export async function fetchStreamingScenario (
  config: ScenarioConfig,
  callbacks: ScenarioCallbacks = {}
): Promise<ScenarioData> {
  const client = new StreamingScenarioClient()
  return await client.fetchScenario(config, callbacks)
}
