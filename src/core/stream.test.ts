import { describe, it, expect } from 'vitest'
import { GenericStreamSender, requestStream, type StreamableProgress } from './stream'

interface Progress extends StreamableProgress {
  seq?: number
}

// Reads whatever a controller was given, the way a response consumer does.
function collector () {
  const chunks: string[] = []
  const controller = {
    enqueue: (c: Uint8Array) => { chunks.push(new TextDecoder().decode(c)) },
    close: () => {},
    error: () => {},
    // A consumer keeping up: never asks the producer to wait.
    desiredSize: 1,
  } as unknown as ReadableStreamDefaultController
  const events = () => chunks.join('').split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as Progress)
  return { controller, events }
}

describe('GenericStreamSender', () => {
  it('delivers events in the order they were sent', async () => {
    const { controller, events } = collector()
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    for (let seq = 0; seq < 5; seq++) {
      sender.onProgress({ isLoading: true, currentStage: 'stops', seq })
    }
    await sender.onProgress({ isLoading: true, currentStage: 'stops', seq: 5 })
    expect(events().map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('flushes a completion that is awaited before the stream closes', async () => {
    const { controller, events } = collector()
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    sender.onProgress({ isLoading: true, currentStage: 'stops' })
    await sender.onComplete()
    await writer.close()
    expect(events().at(-1)?.currentStage).toBe('complete')
  })

  it('drops a completion that is not awaited before the stream closes', async () => {
    // The contract every caller depends on. Writes are queued behind one
    // another so a producer can be made to wait for its consumer, which means
    // closing without awaiting discards whatever has not flushed. This bit
    // the phase endpoints and the VisionEval report, whose entire payload
    // rides on that last event.
    const { controller, events } = collector()
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    sender.onProgress({ isLoading: true, currentStage: 'stops' })
    sender.onComplete()
    await writer.close().catch(() => {})
    expect(events().some(e => e.currentStage === 'complete')).toBe(false)
  })

  it('flushes an error that is awaited before the stream closes', async () => {
    const { controller, events } = collector()
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    await sender.onError(new Error('backend died'))
    await writer.close()
    const last = events().at(-1)
    expect(last?.currentStage).toBe('error')
    expect(last?.error?.message).toBe('backend died')
  })
})

describe('requestStream backpressure', () => {
  it('waits for a consumer that has not drained, then enqueues', async () => {
    // desiredSize at or below zero means the consumer has not taken what is
    // already queued. The write waits rather than piling on, which is what
    // stops a fast producer exhausting the worker.
    let desired = -1
    const enqueued: Uint8Array[] = []
    const controller = {
      enqueue: (c: Uint8Array) => { enqueued.push(c) },
      close: () => {},
      error: () => {},
      get desiredSize () { return desired },
    } as unknown as ReadableStreamDefaultController

    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    const pending = sender.onProgress({ isLoading: true, currentStage: 'stops' })

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(enqueued).toHaveLength(0)

    desired = 1
    await pending
    expect(enqueued).toHaveLength(1)
  })

  it('does not wait when the consumer reports no capacity information', async () => {
    // Test doubles and errored streams report undefined or null; neither
    // should stall the producer.
    const enqueued: Uint8Array[] = []
    const controller = {
      enqueue: (c: Uint8Array) => { enqueued.push(c) },
      close: () => {},
      error: () => {},
    } as unknown as ReadableStreamDefaultController
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    await sender.onProgress({ isLoading: true, currentStage: 'stops' })
    expect(enqueued).toHaveLength(1)
  })
})
