// Turning a stream of ScenarioProgress events into what a loading UI needs:
// which phases this run will execute, and how far through each one it is.
//
// Kept out of the components because three of them consume the same stream
// (browse and the two WSDOT reports) and only one used to do this, so the
// others fell back to a heuristic that read 100% once stops finished while
// departures, two thirds of the work, had not started.
//
// Accumulated from every event rather than watched: several NDJSON lines
// decoded from one network chunk collapse into a single watcher invocation,
// which drops one-off events like the plan announcement.

import { SCENARIO_PHASE_WEIGHTS, type ScenarioPhaseName } from './phases'
import type { ScenarioProgress } from './scenario'

export interface PhaseProgressState {
  // Absent until the run announces its plan, and for streams that predate it
  // (saved example files).
  plan?: ScenarioPhaseName[]
  // Phase -> 0..1. Highest seen wins: stop pagination grows its own
  // denominator mid-phase, so the raw fraction can move backwards.
  fractions: Partial<Record<ScenarioPhaseName, number>>
}

export function emptyPhaseProgress (): PhaseProgressState {
  return { fractions: {} }
}

/**
 * Fold one event into the state. Returns a new object so a caller holding it
 * in a reactive ref sees the change.
 */
export function trackPhaseProgress (
  state: PhaseProgressState,
  progress: ScenarioProgress,
): PhaseProgressState {
  let next = state
  if (progress.phasePlan) {
    // A new plan starts a new run; fractions from the previous one would
    // otherwise show the bar part-filled before anything had happened.
    next = { plan: progress.phasePlan, fractions: {} }
  }
  const pp = progress.phaseProgress
  if (pp) {
    const fraction = pp.total > 0 ? Math.min(pp.completed / pp.total, 1) : 0
    if (fraction > (next.fractions[pp.phase] ?? 0)) {
      next = { plan: next.plan, fractions: { ...next.fractions, [pp.phase]: fraction } }
    }
  }
  return next
}

/**
 * Weighted completion across the run's own plan, 0-100.
 *
 * Weighted, because the phases are nothing like equal: departures carry ten
 * of the fifteen points in a full plan, so counting phases would call a run
 * two thirds done before the expensive part began.
 *
 * Returns null when no plan has been announced, leaving the caller to fall
 * back rather than reporting a confident zero.
 */
export function phaseProgressPercent (state: PhaseProgressState): number | null {
  const plan = state.plan
  if (!plan || plan.length === 0) {
    return null
  }
  let weightTotal = 0
  let weighted = 0
  for (const phase of plan) {
    const weight = SCENARIO_PHASE_WEIGHTS[phase] ?? 1
    weightTotal += weight
    weighted += weight * (state.fractions[phase] ?? 0)
  }
  return weightTotal > 0 ? Math.round((weighted / weightTotal) * 100) : 0
}

/**
 * Whether a run executes this phase, for a UI deciding what to show.
 *
 * An unannounced plan shows everything: a saved example or an older stream
 * carries no plan, and hiding its results would be worse than showing a
 * counter that stays at zero.
 */
export function planRunsPhase (
  plan: ScenarioPhaseName[] | undefined,
  phase: ScenarioPhaseName,
): boolean {
  return !plan || plan.includes(phase)
}
