// The stream envelope every scenario-shaped run shares: the opening 'ready'
// event, a whole-run failure reporter, error reporting on the stream, exactly
// one 'complete', and exactly one close. Only the envelope knows when the
// whole run is finished, so completion belongs here.

import { GenericStreamSender } from '~~/src/core'
import type { GraphQLClient } from '~~/src/core'
import { createFailureReporter, type ScenarioPhaseName } from './phases'
import type { PhaseEmit } from './phases/common'
import type { ScenarioProgress } from './scenario'

// Emit for the run body — the same contract phases use.
export type ProgressEmit = PhaseEmit

// Framing for the run's opening 'ready' event.
export interface ProgressStreamOptions {
  startMessage: string
  // Lets saved stream captures self-describe.
  config?: unknown
  // Every stream declares what it will run; derive with scenarioPhasePlan for
  // a browse config, or pass the run's own declared plan.
  phasePlan: ScenarioPhaseName[]
}

// Run a producer inside the shared stream envelope, returning its result.
// Errors are reported on the stream, then rethrown for in-process callers;
// the stream is settled exactly once whatever happens.
export async function runProgressStream<T> (
  stream: WritableStream,
  client: GraphQLClient,
  opts: ProgressStreamOptions,
  run: (emit: ProgressEmit, onError: (error: any) => void) => Promise<T>,
): Promise<T> {
  const writer = stream.getWriter()
  const sender = new GenericStreamSender<ScenarioProgress>(writer)

  // Failure reports are attributed to the last stage emitted, so reporting
  // one doesn't rewind the stage the loading modal is displaying.
  let lastStage: ScenarioProgress['currentStage'] = 'ready'
  const emit = (p: ScenarioProgress): Promise<void> => {
    lastStage = p.currentStage
    // Returned so producers can pace themselves against the consumer.
    return sender.onProgress(p)
  }
  emit({
    currentStage: 'ready',
    currentStageMessage: opts.startMessage,
    config: opts.config,
    phasePlan: opts.phasePlan,
  })

  // Reports requests that failed after exhausting retries, whichever stage
  // issued them, so a run that finishes with holes in it says so.
  const failures = createFailureReporter(client, emit, () => lastStage)
  try {
    const result = await run(emit, failures.onError)
    await emit({ currentStage: 'complete' })
    return result
  } catch (err) {
    // Awaited before the close: writes queue behind one another, so closing
    // first would drop the event that says what went wrong.
    await sender.onError(err)
    throw err
  } finally {
    failures.dispose()
    // The one place the stream is closed; a failed close must not replace a
    // failure being propagated.
    await writer.close().catch(err => console.error('[ProgressStream] close failed:', err))
  }
}
