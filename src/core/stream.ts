// ============================================================================
// GENERIC STREAMING TYPES
// ============================================================================

/**
 * Base interface for progress data that can be streamed
 */
export interface StreamableProgress {
  isLoading: boolean
  error?: any
  currentStage: string
}

/**
 * Generic callback interface for streaming progress events
 */
export interface StreamCallbacks<T extends StreamableProgress> {
  onProgress?: (progress: T) => void
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

  constructor (private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  send (progress: T): void {
    const data = JSON.stringify(progress) + '\n'
    // console.log(`wrote ${data.length} bytes`)
    this.writer.write(this.encoder.encode(data)).catch(console.error)
  }

  onProgress (progress: T): void {
    this.send(progress)
  }

  onComplete (): void {
    this.send({ isLoading: false, currentStage: 'complete' } as unknown as T)
  }

  onError (error: any): void {
    const errMsg = { message: error.message || 'Unknown error' }
    this.send({ isLoading: false, currentStage: 'error', error: errMsg } as unknown as T)
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

export const requestStream = (controller: ReadableStreamDefaultController): WritableStream => {
  // Create writable stream writer that writes to the response
  return new WritableStream({
    write (chunk) {
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
