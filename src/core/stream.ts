// ============================================================================
// GENERIC STREAMING TYPES
// ============================================================================

/**
 * Base interface for progress data that can be streamed
 */
export interface StreamableProgress {
  error?: any
  currentStage: string
}

/**
 * Generic callback interface for streaming progress events
 */
export interface StreamCallbacks<T extends StreamableProgress> {
  // Awaitable so a producer can apply backpressure. Consumers that just
  // accumulate return void and are unaffected.
  onProgress?: (progress: T) => void | Promise<void>
  onComplete?: () => void
  onError?: (error: string) => void
}

/**
 * Generic data receiver interface for accumulating streamed data
 */
export interface StreamDataReceiver<T extends StreamableProgress, TData> {
  onProgress(progress: T): void
  onComplete(): void
  onError(error: any): void
  getCurrentData(): TData
}

// ============================================================================
// GENERIC STREAMING IMPLEMENTATIONS
// ============================================================================

/**
 * Generic stream sender that writes progress data to a stream
 */
export class GenericStreamSender<T extends StreamableProgress> implements StreamCallbacks<T> {
  private encoder = new TextEncoder()
  // Writes are serialized: the next one is queued behind the last, so awaiting
  // what send() returns means everything emitted so far has reached the sink.
  private tail: Promise<void> = Promise.resolve()

  constructor (private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  /**
   * Queue one event. The returned promise settles when it has been written,
   * which for a response stream means when the consumer has taken it.
   *
   * Awaiting it is what bounds memory: without that, a producer faster than
   * its consumer piles every unread event onto the heap, which is how a
   * statewide report killed a 128 MB Worker while the same stream drained
   * fine into a fast reader.
   */
  send (progress: T): Promise<void> {
    const data = JSON.stringify(progress) + '\n'
    const chunk = this.encoder.encode(data)
    this.tail = this.tail
      .then(() => this.writer.write(chunk))
      .catch(console.error)
    return this.tail
  }

  onProgress (progress: T): Promise<void> {
    return this.send(progress)
  }

  // Both return the queued write, so a caller about to close the stream can
  // await it. Writes are queued behind one another now, so closing without
  // awaiting drops whatever has not been flushed yet.
  onComplete (): Promise<void> {
    return this.send({ currentStage: 'complete' } as unknown as T)
  }

  onError (error: any): Promise<void> {
    const errMsg = { message: error.message || 'Unknown error' }
    return this.send({ currentStage: 'error', error: errMsg } as unknown as T)
  }
}

/**
 * Generic streaming client that processes readable streams
 */
export interface StreamResult<TData> {
  data: TData
  /**
   * True only if the server explicitly sent a 'complete' stage message.
   * False if the stream ended without this message (e.g., server OOM kill,
   * network disconnect, or other abnormal termination).
   *
   * Use this to distinguish:
   * - `success: true` = server confirmed it finished successfully
   * - `success: false` = stream ended but we don't know if server finished
   */
  success: boolean
}

export class GenericStreamReceiver<T extends StreamableProgress, TData> {
  /**
   * Process a readable stream of progress data.
   *
   * Returns { data, success } where:
   * - `data`: accumulated data from all received progress messages
   * - `success`: true only if we received an explicit 'complete' stage message
   *
   * IMPORTANT: The stream can end in two ways:
   * 1. Server sends 'complete' stage, then closes connection -> success=true
   * 2. Connection closes without 'complete' (OOM, crash, timeout) -> success=false
   *
   * In both cases, receiver.onComplete() is called to allow cleanup, but only
   * case 1 means the server actually finished its work successfully.
   */
  async processStream (
    stream: ReadableStream<Uint8Array>,
    receiver: StreamDataReceiver<T, TData>
  ): Promise<StreamResult<TData>> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let receivedCompleteMessage = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer
        for (const line of lines) {
          if (!line.trim()) { continue }
          const progress = JSON.parse(line) as T
          receiver.onProgress(progress)
          if (progress.error) {
            receiver.onError(progress.error)
          }
          if (progress.currentStage === 'complete') {
            receivedCompleteMessage = true
            receiver.onComplete()
          }
        }
      }
    } catch (error) {
      receiver.onError(error)
    } finally {
      // Always call onComplete for cleanup, even if stream ended abnormally.
      // The receivedCompleteMessage flag tells callers whether the server
      // actually finished vs the connection was terminated unexpectedly.
      if (!receivedCompleteMessage) {
        receiver.onComplete()
      }
      reader.releaseLock()
    }

    return { data: receiver.getCurrentData(), success: receivedCompleteMessage }
  }
}

// ============================================================================
// Utility functions to create and manage streams
// ============================================================================

// How long a write waits for the consumer before giving up and enqueuing
// anyway. A consumer that has stopped reading entirely should not wedge the
// producer forever; letting it through risks memory, hanging risks the request.
const BACKPRESSURE_TIMEOUT_MS = 30_000
const BACKPRESSURE_POLL_MS = 20

export const requestStream = (controller: ReadableStreamDefaultController): WritableStream => {
  // Create writable stream writer that writes to the response
  return new WritableStream({
    async write (chunk) {
      // Wait for the consumer to drain what is already queued. `desiredSize`
      // is null on an errored stream and undefined on the plain object test
      // doubles use, and neither should block.
      const deadline = Date.now() + BACKPRESSURE_TIMEOUT_MS
      while (typeof controller.desiredSize === 'number'
        && controller.desiredSize <= 0
        && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, BACKPRESSURE_POLL_MS))
      }
      controller.enqueue(chunk)
    },
    close () {
      controller.close()
    },
    abort (error) {
      controller.error(error)
    }
  })
}

export const multiplexStream = (originalStream: WritableStream): { inputStream: WritableStream, outputStream: ReadableStream } => {
  // Create a transform stream that splits data to two destinations
  const originalWriter = originalStream.getWriter()

  const { readable, writable } = new TransformStream({
    async transform (chunk, controller) {
      // Send chunk to the new output stream
      controller.enqueue(chunk)
      // Also write to the original stream
      await originalWriter.write(chunk)
    },
    async flush () {
      // Close both streams when done
      await originalWriter.close()
    }
  })

  return {
    inputStream: writable, // Stream to write data into
    outputStream: readable // New stream that receives the same data
  }
}

// Generic helper function to chunk arrays into smaller arrays
export function chunkArray<T> (array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize))
  }
  return chunks
}
