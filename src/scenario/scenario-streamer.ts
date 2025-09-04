import { GenericStreamSender, GenericStreamReceiver } from '../stream'
import type {
  ScenarioData
} from './scenario'
import type {
  ScenarioDataReceiver,
  ScenarioCallbacks,
  ScenarioProgress
} from './scenario-fetcher'

// ============================================================================
// SCENARIO-SPECIFIC IMPLEMENTATIONS (backward compatibility)
// ============================================================================

/**
 * ScenarioCallbacks that write progress data to a stream
 */
export class ScenarioStreamSender extends GenericStreamSender<ScenarioProgress> implements ScenarioCallbacks {}

/**
 * Streaming client processes readable streams and uses ScenarioDataReceiver
 */
export class ScenarioStreamReceiver extends GenericStreamReceiver<ScenarioProgress, ScenarioData> {
  /**
   * Convenience method to process a stream with ScenarioDataReceiver
   * This maintains backward compatibility with existing code
   */
  async processStreamWithScenarioReceiver (
    stream: ReadableStream<Uint8Array>,
    receiver: ScenarioDataReceiver
  ): Promise<ScenarioData> {
    return this.processStream(stream, receiver)
  }
}
