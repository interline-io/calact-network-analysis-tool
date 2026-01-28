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
  completed: boolean
}

export class GenericStreamReceiver<T extends StreamableProgress, TData> {
  /**
   * Process a readable stream of progress data
   * Returns { data, completed } where completed indicates if the stream
   * ended normally with a 'complete' stage (vs early termination like OOM)
   */
  async processStream (
    stream: ReadableStream<Uint8Array>,
    receiver: StreamDataReceiver<T, TData>
  ): Promise<StreamResult<TData>> {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let completed = false
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
            completed = true
            receiver.onComplete()
          }
        }
      }
    } catch (error) {
      receiver.onError(error)
    } finally {
      if (!completed) {
        receiver.onComplete()
      }
      reader.releaseLock()
    }

    return { data: receiver.getCurrentData(), completed }
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
