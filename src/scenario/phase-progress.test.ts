import { describe, it, expect } from 'vitest'
import { emptyPhaseProgress, phaseProgressPercent, planRunsPhase, trackPhaseProgress } from './phase-progress'
import type { ScenarioProgress } from './scenario'

const event = (p: Partial<ScenarioProgress>): ScenarioProgress =>
  ({ currentStage: 'stops', ...p }) as ScenarioProgress

describe('trackPhaseProgress', () => {
  it('records the plan the run announces', () => {
    const s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['feed-versions', 'stops'] }))
    expect(s.plan).toEqual(['feed-versions', 'stops'])
  })

  it('keeps the furthest a phase has reached', () => {
    // Stop pagination grows its own denominator mid-phase, so the raw
    // fraction moves backwards and the bar would jump about.
    let s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['stops'] }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 8, total: 10 } }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 9, total: 20 } }))
    expect(s.fractions.stops).toBeCloseTo(0.8)
  })

  it('clamps a phase that reports more completed than total', () => {
    let s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['stops'] }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 12, total: 10 } }))
    expect(s.fractions.stops).toBe(1)
  })

  it('treats an empty phase as no progress rather than dividing by zero', () => {
    let s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['stops'] }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 0, total: 0 } }))
    expect(s.fractions.stops ?? 0).toBe(0)
  })

  it('clears fractions when a new plan is announced', () => {
    // A second run in the same session would otherwise start part-filled.
    let s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['stops'] }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 10, total: 10 } }))
    s = trackPhaseProgress(s, event({ phasePlan: ['feed-versions', 'stops'] }))
    expect(s.fractions).toEqual({})
    expect(s.plan).toEqual(['feed-versions', 'stops'])
  })
})

describe('phaseProgressPercent', () => {
  it('weights departures far above the phases around it', () => {
    // Departures carry ten of the fifteen points in this plan. Finishing
    // everything else is a minority of the run, and reporting it as complete
    // is what the old heuristic did.
    let s = trackPhaseProgress(emptyPhaseProgress(), event({
      phasePlan: ['feed-versions', 'stops', 'routes', 'departures'],
    }))
    for (const phase of ['feed-versions', 'stops', 'routes'] as const) {
      s = trackPhaseProgress(s, event({ phaseProgress: { phase, completed: 1, total: 1 } }))
    }
    expect(phaseProgressPercent(s)).toBe(29)

    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'departures', completed: 1, total: 1 } }))
    expect(phaseProgressPercent(s)).toBe(100)
  })

  it('counts only the phases this run executes', () => {
    // A plan without departures reaches 100 on its own terms.
    let s = trackPhaseProgress(emptyPhaseProgress(), event({ phasePlan: ['feed-versions', 'stops'] }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'feed-versions', completed: 1, total: 1 } }))
    s = trackPhaseProgress(s, event({ phaseProgress: { phase: 'stops', completed: 1, total: 1 } }))
    expect(phaseProgressPercent(s)).toBe(100)
  })

  it('returns null with no plan, so a caller can fall back', () => {
    expect(phaseProgressPercent(emptyPhaseProgress())).toBeNull()
  })
})

describe('planRunsPhase', () => {
  it('reports the phases in the plan', () => {
    expect(planRunsPhase(['feed-versions', 'stops', 'routes', 'departures'], 'departures')).toBe(true)
    expect(planRunsPhase(['feed-versions', 'stops', 'routes', 'departures'], 'flex-areas')).toBe(false)
  })

  it('shows nothing before the plan is announced', () => {
    // The plan rides the run's opening event, so this window lasts until the
    // first NDJSON line is processed.
    expect(planRunsPhase(undefined, 'flex-areas')).toBe(false)
  })
})
