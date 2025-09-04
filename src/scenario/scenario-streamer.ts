import type {
  ScenarioData
} from './scenario'
import type {
  ScenarioDataReceiver,
  ScenarioCallbacks,
  ScenarioProgress
} from './scenario-fetcher'

// ============================================================================
// STREAMING SERVER IMPLEMENTATION
// ============================================================================

/**
 * ScenarioCallbacks that write progress data to a stream
 */
export class ScenarioStreamSender implements ScenarioCallbacks {
  private encoder = new TextEncoder()

  constructor (private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  send (progress: ScenarioProgress): void {
    const data = JSON.stringify(progress) + '\n'
    // console.log(`wrote ${data.length} bytes`)
    this.writer.write(this.encoder.encode(data)).catch(console.error)
  }

  onProgress (progress: ScenarioProgress): void {
    this.send(progress)
  }

  onComplete (): void {
    this.send({ isLoading: false, currentStage: 'complete' })
  }

  onError (error: any): void {
    const errMsg = { message: error.message || 'Unknown error' }
    this.send({ isLoading: false, currentStage: 'complete', error: errMsg })
  }
}

// ============================================================================
// STREAMING CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Streaming client processes readable streams and uses ScenarioDataReceiver
 */
export class ScenarioStreamReceiver {
  /**
   * Process a readable stream of scenario data
   */
  async processStream (
    stream: ReadableStream<Uint8Array>,
    receiver: ScenarioDataReceiver
  ): Promise<ScenarioData> {
    console.log('ScenarioStreamReceiver: Starting to process stream...')
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        console.log('ScenarioStreamReceiver: ...read chunk', { done, valueLength: value?.length || 0 })
        if (done) {
          console.log('ScenarioStreamReceiver: Stream fully read')
          break
        }

        buffer += decoder.decode(value, { stream: true })
        // console.log(`...read ${buffer.length} bytes`)
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) { continue }
          const scenarioProgress = JSON.parse(line) as ScenarioProgress
          receiver.onProgress(scenarioProgress)
          if (scenarioProgress.currentStage === 'complete') {
            receiver.onComplete()
          }
        }
      }
    } catch (error) {
      receiver.onError(error)
    } finally {
      reader.releaseLock()
    }

    // Return current accumulated data if stream ended without completion
    return receiver.getCurrentData()
  }
}
