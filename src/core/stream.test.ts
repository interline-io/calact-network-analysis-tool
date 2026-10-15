import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  GenericStreamSender,
  postStream,
  producerStream,
  requestStream,
  workerStream,
  type StreamableProgress,
  type StreamWorker,
  type StreamWorkerMessage,
} from './stream'

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
      sender.onProgress({ currentStage: 'stops', seq })
    }
    await sender.onProgress({ currentStage: 'stops', seq: 5 })
    expect(events().map(e => e.seq)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('flushes a completion that is awaited before the stream closes', async () => {
    const { controller, events } = collector()
    const writer = requestStream(controller).getWriter()
    const sender = new GenericStreamSender<Progress>(writer)
    sender.onProgress({ currentStage: 'stops' })
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
    sender.onProgress({ currentStage: 'stops' })
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
    const pending = sender.onProgress({ currentStage: 'stops' })

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
    await sender.onProgress({ currentStage: 'stops' })
    expect(enqueued).toHaveLength(1)
  })
})

describe('producerStream', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Decodes one chunk, which a sender writes as exactly one NDJSON event.
  const decode = (chunk: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(chunk)) as Progress

  it('delivers what the run writes, then ends', async () => {
    const stream = producerStream(async (controller) => {
      const writer = requestStream(controller).getWriter()
      const sender = new GenericStreamSender<Progress>(writer)
      await sender.onProgress({ currentStage: 'stops', seq: 1 })
      await writer.close()
    })
    const reader = stream.getReader()
    expect(decode((await reader.read()).value).seq).toBe(1)
    expect((await reader.read()).done).toBe(true)
  })

  it('errors the stream when the run throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stream = producerStream(async () => {
      throw new Error('backend died')
    })
    await expect(stream.getReader().read()).rejects.toThrow('backend died')
  })
})

describe('workerStream', () => {
  // Decodes one chunk, which a sender writes as exactly one NDJSON event.
  const decode = (chunk: Uint8Array | undefined) => JSON.parse(new TextDecoder().decode(chunk)) as Progress
  const encode = (p: Progress) => new TextEncoder().encode(JSON.stringify(p) + '\n')

  // A worker that records what the page posts, and replies when told to.
  function fakeWorker () {
    const posted: unknown[] = []
    let terminated = false
    const worker: StreamWorker = {
      onmessage: null,
      onerror: null,
      postMessage: (message: unknown) => { posted.push(message) },
      terminate: () => { terminated = true },
    }
    const reply = (message: StreamWorkerMessage) => {
      worker.onmessage?.call(worker as Worker, { data: message } as MessageEvent)
    }
    return { worker, posted, reply, terminated: () => terminated }
  }

  it('posts the request, relays chunks, and terminates the worker when done', async () => {
    const { worker, posted, reply, terminated } = fakeWorker()
    const reader = workerStream(worker, { endpoint: 'scenario' }).getReader()
    expect(posted).toEqual([{ endpoint: 'scenario' }])

    reply({ type: 'chunk', chunk: encode({ currentStage: 'stops', seq: 1 }) })
    reply({ type: 'done' })
    expect(decode((await reader.read()).value).seq).toBe(1)
    expect((await reader.read()).done).toBe(true)
    expect(terminated()).toBe(true)
  })

  it('errors the stream when the worker reports a failure', async () => {
    const { worker, reply, terminated } = fakeWorker()
    const reader = workerStream(worker, {}).getReader()
    reply({ type: 'error', message: 'backend died' })
    await expect(reader.read()).rejects.toThrow('backend died')
    expect(terminated()).toBe(true)
  })

  it('terminates the worker on abort, and ignores what it sent after', async () => {
    const { worker, reply, terminated } = fakeWorker()
    const abort = new AbortController()
    const reader = workerStream(worker, {}, abort.signal).getReader()
    reply({ type: 'chunk', chunk: encode({ currentStage: 'stops', seq: 1 }) })
    expect(decode((await reader.read()).value).seq).toBe(1)

    abort.abort()
    expect(terminated()).toBe(true)
    // A message already queued when the worker was terminated.
    reply({ type: 'chunk', chunk: encode({ currentStage: 'stops', seq: 2 }) })
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reads back what postStream relays from a run', async () => {
    const { worker, reply } = fakeWorker()
    const reader = workerStream(worker, {}).getReader()
    await postStream(producerStream(async (controller) => {
      const writer = requestStream(controller).getWriter()
      const sender = new GenericStreamSender<Progress>(writer)
      await sender.onProgress({ currentStage: 'stops', seq: 1 })
      await sender.onComplete()
      await writer.close()
    }), reply)
    expect(decode((await reader.read()).value).seq).toBe(1)
    expect(decode((await reader.read()).value).currentStage).toBe('complete')
    expect((await reader.read()).done).toBe(true)
  })

  it('relays a failed run as an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { worker, reply } = fakeWorker()
    const reader = workerStream(worker, {}).getReader()
    await postStream(producerStream(async () => {
      throw new Error('backend died')
    }), reply)
    await expect(reader.read()).rejects.toThrow('backend died')
    vi.restoreAllMocks()
  })
})
