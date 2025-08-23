import { BasicGraphQLClient } from './graphql'
import type {
  ScenarioConfig,
  ScenarioData
} from './scenario'
import {
  type ScenarioCallbacks,
  type ScenarioProgress,
  ScenarioDataReceiver,
  ScenarioFetcher
} from './scenario-fetcher'

// ============================================================================
// STREAMING SERVER IMPLEMENTATION
// ============================================================================

/**
 * Server-side streaming sender
 * Converts ScenarioFetcher progress events to JSON messages over the wire
 */
export class ScenarioDataSender {
  private sendMessage: (message: ScenarioProgress) => void

  constructor (sendMessage: (message: ScenarioProgress) => void) {
    this.sendMessage = sendMessage
  }

  /**
   * Send scenario data using ScenarioFetcher with streaming callbacks
   */
  async sendScenario (config: ScenarioConfig): Promise<void> {
    try {
      // Create GraphQL client
      const client = new BasicGraphQLClient(
        process.env.TRANSITLAND_API_ENDPOINT || 'https://transit.land/api/v2/query',
        process.env.TRANSITLAND_API_KEY || 'test-key'
      )

      // Create ScenarioFetcher with streaming message sender
      const scenarioFetcher = new ScenarioFetcher(config, client, {
        onProgress: (progress) => {
          this.sendMessage(progress)
        },
        onComplete: () => {
          // onComplete is called but the result is returned from fetch()
          // We'll send the complete message after fetch() returns
        },
        onError: (error) => {
          console.error('ScenarioFetcher error:', error)
          this.sendMessage({
            isLoading: false,
            currentStage: 'complete',
            error: { message: error.message || 'Unknown error in ScenarioFetcher' }
          })
        }
      })

      // Start the scenario fetching process and get the final result
      await scenarioFetcher.fetch()

      // Send the complete message with the final result
      // this.sendMessage({ type: 'complete' })
    } catch (error) {
      console.error('Error in ScenarioDataSender:', error)
      this.sendMessage({
        isLoading: false,
        currentStage: 'complete',
        error: { message: error instanceof Error ? error.message : 'Unknown error in ScenarioDataSender' }
      })
      throw error
    }
  }
}

// ============================================================================
// STREAMING CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Streaming client receives messages from server and uses ScenarioDataReceiver
 */
export class ScenarioClient {
  /**
   * Fetch scenario data using streaming from server
   */
  async fetchScenario (
    config: ScenarioConfig,
    callbacks: ScenarioCallbacks = {}
  ): Promise<ScenarioData> {
    // Validate config
    if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      throw new Error('Either bbox or geographyIds must be provided')
    }

    // Create receiver to accumulate data from streaming messages
    const receiver = new ScenarioDataReceiver(callbacks)
    const response = await fetch('/api/scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config),
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
        receiver.onProgress(JSON.parse(line) as ScenarioProgress)
      }
    }

    // Return current accumulated data if stream ended without completion
    return receiver.getCurrentData()
  }
}
