// The stream envelope every scenario-shaped run shares: the opening 'ready'
// event, a failure reporter covering the whole run, error reporting on the
// stream, exactly one 'complete', and exactly one close. Server endpoints
// wrap an HTTP response controller; CLI and test runs wrap their own streams.
//
// Completion belongs here rather than to any fetcher or analysis stage: only
// the envelope knows the whole run is finished, so a consumer can never count
// a stream as complete while a later stage still has work to do.

import { GenericStreamSender } from '~~/src/core'
import type { GraphQLClient } from '~~/src/core'
import { createFailureReporter } from './phases'
import type { ScenarioProgress } from './scenario'

// Emit for the run body. Awaitable: a run that just emitted a bulk payload
// should await it, so a producer faster than its consumer waits rather than
// piling unread events on the heap.
export type ProgressEmit = (progress: ScenarioProgress) => void | Promise<void>

export interface ProgressStreamOptions {
  // Message on the opening 'ready' event.
  startMessage: string
  // Attached to the 'ready' event. Saved example streams carry the run's
  // config this way, and /api/examples reads it back out of them.
  config?: unknown
}

// Run a scenario-shaped producer inside the shared stream envelope.
//
// Errors are reported on the stream, then rethrown for in-process callers
// that build a result out of the run's return value — an empty result is
// often structurally valid and would read as a real, empty region. The
// stream is settled exactly once whatever happens; server wrappers should
// still backstop with controller.error for throws outside the envelope.
export async function runProgressStream (
  stream: WritableStream,
  client: GraphQLClient,
  opts: ProgressStreamOptions,
  run: (emit: ProgressEmit, onError: (error: any) => void) => Promise<unknown>,
): Promise<void> {
  const writer = stream.getWriter()
  const sender = new GenericStreamSender<ScenarioProgress>(writer)

  // Failure reports are attributed to the last stage emitted, so reporting
  // one doesn't rewind the stage the loading modal is displaying.
  let lastStage: ScenarioProgress['currentStage'] = 'ready'
  const emit = (p: ScenarioProgress): Promise<void> => {
    lastStage = p.currentStage
    // Returned, not dropped: the phases await this to pace themselves against
    // the consumer. Swallowing the promise would put the run back on an
    // unbounded write queue.
    return sender.onProgress(p)
  }
  emit({
    isLoading: true,
    currentStage: 'ready',
    currentStageMessage: opts.startMessage,
    config: opts.config,
  })

  // Installed for the whole run, so a request that fails after exhausting its
  // retries is reported whichever stage issued it, and a run that finishes
  // with holes in it says so.
  const failures = createFailureReporter(client, emit, () => lastStage)
  try {
    await run(emit, failures.onError)
    await emit({ isLoading: false, currentStage: 'complete' })
  } catch (err) {
    // Awaited before the close in finally: writes are queued behind one
    // another, so closing first would drop the event that says what went
    // wrong. The consumer gets the error and a closed stream rather than a
    // request that never ends.
    await sender.onError(err)
    throw err
  } finally {
    failures.dispose()
    // The one place the stream is closed. A close that fails — the consumer
    // already went away — must not replace a failure being propagated.
    await writer.close().catch(err => console.error('[ProgressStream] close failed:', err))
  }
}
