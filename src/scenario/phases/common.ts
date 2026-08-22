// Shared plumbing for scenario phases. Each phase is a pure function over an
// explicit, JSON-serializable config, callable inline by ScenarioFetcher or
// standalone via its own server endpoint.

import { parseCalendarDate, TaskQueue } from '~~/src/core'
import type { GraphQLClient, RequestFailure } from '~~/src/core'
import type { ScenarioProgress } from '../scenario'

// Progress callback for phases. Awaitable so a producer faster than its
// consumer waits rather than piling unread events on the heap.
export type PhaseEmit = (progress: ScenarioProgress) => void | Promise<void>

export interface PhaseOpts {
  // Per-task (non-fatal) errors; the phase continues processing remaining
  // tasks. Phase-fatal errors are thrown instead.
  onError?: (error: any) => void
}

// Concurrent GraphQL requests per phase queue.
export const PHASE_MAX_CONCURRENT_REQUESTS = 8

// Phase identities for the progress plan and weights. 'buffers' covers all
// four buffer passes as one slice; the 'wsdot-*' phases are implemented in
// src/analysis/wsdot, with only their identity living here.
export type ScenarioPhaseName = 'feed-versions' | 'stops' | 'stop-census' | 'routes' | 'departures' | 'buffers' | 'stop-clusters' | 'flex-areas' | 'census-values' | 'wsdot-levels' | 'wsdot-geographies'

// Pipeline ordering for phase plans and progress display. Report phases come
// after the fetch phases they consume.
export const SCENARIO_PHASE_ORDER: ScenarioPhaseName[] = [
  'feed-versions', 'stops', 'stop-census', 'routes', 'departures', 'buffers', 'stop-clusters', 'flex-areas', 'census-values',
  'wsdot-levels', 'wsdot-geographies',
]

// Relative progress-bar weight per phase, normalized over the run's plan.
// Rough cost ratios — tune from stage timings as data accumulates.
export const SCENARIO_PHASE_WEIGHTS: Record<ScenarioPhaseName, number> = {
  'feed-versions': 1,
  'stops': 2,
  'stop-census': 1,
  'routes': 1,
  'departures': 10,
  'buffers': 3,
  'stop-clusters': 2,
  'flex-areas': 1,
  'census-values': 1,
  'wsdot-levels': 1,
  'wsdot-geographies': 3,
}

// Final tick for a phase's progress slice; also fills the slice for a
// zero-task queue, whose 0/0 counter would otherwise read as fraction 0.
export function phaseDone (phase: ScenarioPhaseName): { phase: ScenarioPhaseName, completed: number, total: number } {
  return { phase, completed: 1, total: 1 }
}

// Progress plumbing for a queue-driven phase: a TaskQueue whose ticks emit
// the phase's progress slice, an event builder for payload emissions, and a
// `done` bookend that closes the slice.
export function phaseQueue<T> (
  phase: ScenarioPhaseName,
  emit: PhaseEmit,
  task: (item: T) => Promise<void>,
  opts: PhaseOpts = {},
): { queue: TaskQueue<T>, progressEvent: () => ScenarioProgress, done: () => void | Promise<void> } {
  const queue: TaskQueue<T> = new TaskQueue<T>(PHASE_MAX_CONCURRENT_REQUESTS, task, {
    onProgress: () => { emit(progressEvent()) },
    onError: error => opts.onError?.(error),
  })
  const progressEvent = (): ScenarioProgress => {
    const p = queue.getProgress()
    return {
      currentStage: phase,
      phaseProgress: { phase, completed: p.completed, total: p.total },
    }
  }
  const done = (): void | Promise<void> => emit({ currentStage: phase, phaseProgress: phaseDone(phase) })
  return { queue, progressEvent, done }
}

// The slim feed version identity that stops/flex phases need — full
// FeedVersion objects don't cross the standalone-request boundary.
export interface FeedVersionRef {
  feedOnestopId: string
  feedVersionSha1: string
}

// Expands a config's date range into calendar days. Configs cross a JSON
// boundary, so dates are read as local-midnight calendar dates to survive
// whatever zone the runtime is in.
export function getSelectedDateRange (config: { startDate?: Date, endDate?: Date }): Date[] {
  const sd = parseCalendarDate(config.startDate) || new Date()
  const ed = parseCalendarDate(config.endDate) || new Date()
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  return dates
}

export interface FailureReporter {
  // Pass as PhaseOpts.onError so an abandoned task is reported too.
  onError: (error: any) => void
  dispose: () => void
}

// Reports every request that failed after exhausting its retries, so a run
// that finishes with holes in it says so. `onError` covers tasks abandoned
// for other reasons, skipping failures the client hook already reported.
export function createFailureReporter (
  client: GraphQLClient,
  emit: PhaseEmit,
  currentStage: () => ScenarioProgress['currentStage'],
): FailureReporter {
  const reported = new WeakSet<object>()
  const report = (failure: RequestFailure): void => {
    emit({ currentStage: currentStage(), requestErrors: [failure] })
  }
  const previous = client.onRequestError
  client.onRequestError = (failure, error) => {
    if (error && typeof error === 'object') {
      reported.add(error)
    }
    report(failure)
  }
  return {
    onError (error: any): void {
      if (error && typeof error === 'object' && reported.has(error)) {
        return
      }
      console.warn('[Scenario] task abandoned after error:', error)
      report({
        operation: currentStage(),
        attempts: 1,
        message: error?.message || String(error),
      })
    },
    dispose (): void {
      // Restore rather than clear, so disposing never clobbers a hook
      // installed around this one.
      client.onRequestError = previous
    },
  }
}
