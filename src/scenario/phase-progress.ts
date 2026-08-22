// Turns a stream of ScenarioProgress events into what a loading UI needs:
// which phases this run will execute, and how far through each one it is.
// Fold every event through trackPhaseProgress — watching only the latest
// event drops one-off events like the plan announcement.

import { SCENARIO_PHASE_WEIGHTS, type ScenarioPhaseName } from './phases'
import type { ScenarioProgress } from './scenario'

export interface PhaseProgressState {
  // Absent until the run's opening event announces its plan.
  plan?: ScenarioPhaseName[]
  // Phase -> 0..1. Highest seen wins: stop pagination grows its own
  // denominator mid-phase, so the raw fraction can move backwards.
  fractions: Partial<Record<ScenarioPhaseName, number>>
}

export function emptyPhaseProgress (): PhaseProgressState {
  return { fractions: {} }
}

// Fold one event into the state. Returns a new object so a caller holding it
// in a reactive ref sees the change.
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

// Weighted completion across the run's own plan, 0-100, or null before the
// plan announcement arrives. Weighted because the phases are nothing alike:
// counting them equally would call a run mostly done before departures began.
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

// Whether a run executes this phase, for a UI deciding what to show. False
// until the run's opening event announces its plan.
export function planRunsPhase (
  plan: ScenarioPhaseName[] | undefined,
  phase: ScenarioPhaseName,
): boolean {
  return plan?.includes(phase) ?? false
}
