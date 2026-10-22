import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useIsochrone, type IsochroneFetcher } from '../../app/composables/useIsochrone'
import type { IsochroneParams } from '../../src/tl'
import { isochroneRecording } from '../isochrone-recordings'

// The router can't run in the test stack, so the one fetch is replaced with
// recorded responses.
const recorded = isochroneRecording

const base: IsochroneParams = {
  place: { lat: 45.5189, lon: -122.6793 },
  arriveBy: false,
  date: '2026-10-27',
  time: '08:00',
  cutoffs: [15, 30, 45],
  mode: { walkOnly: false },
  maxWalk: 800,
}

interface Call {
  query: URLSearchParams
  signal: AbortSignal
  resolve: (r: { status: number, body: string }) => void
}

// A fetcher whose responses the test sends, in whatever order it likes.
function controlledFetcher () {
  const calls: Call[] = []
  const fetcher: IsochroneFetcher = (query, signal) => new Promise((resolve) => {
    calls.push({ query, signal, resolve })
  })
  return { calls, fetcher }
}

function setup (initial: IsochroneParams | undefined, fetcher: IsochroneFetcher) {
  const params = ref<IsochroneParams | undefined>(initial)
  const scope = effectScope()
  const state = scope.run(() => useIsochrone(params, fetcher))!
  return { params, scope, state }
}

async function settle () {
  await vi.advanceTimersByTimeAsync(400)
  await nextTick()
}

describe('useIsochrone', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks nothing while closed', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { state, scope } = setup(undefined, fetcher)
    await settle()
    expect(calls).toHaveLength(0)
    expect(state.bands.value).toEqual([])
    scope.stop()
  })

  it('fetches at once when opened', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { params, scope } = setup(undefined, fetcher)
    params.value = base
    await nextTick()
    expect(calls).toHaveLength(1)
    scope.stop()
  })

  it('fetches changes once they stop, and shows the bands', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { params, state, scope } = setup(base, fetcher)
    expect(calls).toHaveLength(1)
    params.value = { ...base, time: '08:05' }
    params.value = { ...base, time: '08:10' }
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.query.get('time')).toBe('08:10:00')
    expect(state.loading.value).toBe(true)
    calls[1]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    expect(state.loading.value).toBe(false)
    expect(state.bands.value.map(b => b.minutes)).toEqual([15, 30, 45])
    expect(state.error.value).toBeNull()
    expect(state.empty.value).toBe(false)
    scope.stop()
  })

  it('never lets a superseded response overwrite a newer one', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { params, state, scope } = setup(base, fetcher)
    await settle()
    // The origin is dragged before the first answer comes back.
    params.value = { ...base, place: { lat: 45.53, lon: -122.66 } }
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls[0]!.signal.aborted).toBe(true)
    calls[1]!.resolve(recorded('walk-only'))
    await nextTick()
    await nextTick()
    calls[0]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    expect(state.bands.value.map(b => b.minutes)).toEqual([10, 20])
    scope.stop()
  })

  it('shows the router error, and clears it with the next answer', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { params, state, scope } = setup({ ...base, date: '2026-13-45' }, fetcher)
    await settle()
    calls[0]!.resolve(recorded('bad-date'))
    await nextTick()
    await nextTick()
    expect(state.error.value).toMatch(/date/i)
    expect(state.bands.value).toEqual([])
    params.value = base
    await settle()
    calls[1]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    expect(state.error.value).toBeNull()
    expect(state.bands.value).toHaveLength(3)
    scope.stop()
  })

  it('shows loading only once a request has taken a while', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { state, scope } = setup(base, fetcher)
    await vi.advanceTimersByTimeAsync(200)
    expect(state.loading.value).toBe(true)
    expect(state.showLoading.value).toBe(false)
    await vi.advanceTimersByTimeAsync(100)
    expect(state.showLoading.value).toBe(true)
    calls[0]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    expect(state.showLoading.value).toBe(false)
    scope.stop()
  })

  it('drops the bands and the request in flight when closed', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { params, state, scope } = setup(base, fetcher)
    await settle()
    calls[0]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    params.value = { ...base, time: '09:00' }
    await settle()
    params.value = undefined
    await nextTick()
    expect(calls[1]!.signal.aborted).toBe(true)
    expect(state.bands.value).toEqual([])
    expect(state.loading.value).toBe(false)
    calls[1]!.resolve(recorded('leaving-from'))
    await nextTick()
    await nextTick()
    expect(state.bands.value).toEqual([])
    scope.stop()
  })

  it('sends the debug menu rendering knobs', async () => {
    const { calls, fetcher } = controlledFetcher()
    const { state, scope } = setup(base, fetcher)
    await settle()
    state.render.cellSize = 50
    await settle()
    expect(calls[1]!.query.get('cellSize')).toBe('50')
    scope.stop()
  })
})
