import { describe, it, expect } from 'vitest'
import { ref, nextTick, watch } from 'vue'
import type { LocationQuery, LocationQueryRaw } from 'vue-router'
import { PendingQuery } from '../../app/composables/pendingQuery'

// A router stand-in whose navigation lands a little later, as a real one does.
function setup (initial: LocationQuery = {}) {
  const url = ref<LocationQuery>(initial)
  const navigations: LocationQueryRaw[] = []
  const pq = new PendingQuery(() => url.value, async (query) => {
    navigations.push(query)
    await new Promise(resolve => setTimeout(resolve, 5))
    url.value = query as LocationQuery
  })
  return { url, navigations, pq }
}

describe('PendingQuery', () => {
  it('reads a write back at once, before the URL has it', () => {
    const { url, pq } = setup({ a: '1' })
    pq.set({ fareMax: '2.75' })
    expect(pq.query.value).toEqual({ a: '1', fareMax: '2.75' })
    expect(url.value).toEqual({ a: '1' })
  })

  it('sends writes from the same tick in one navigation, keeping other keys', async () => {
    const { url, navigations, pq } = setup({ a: '1', b: '2' })
    pq.set({ fareMax: '3' })
    const done = pq.set({ fareMin: '1', b: undefined })
    await done
    expect(navigations).toEqual([{ a: '1', fareMax: '3', fareMin: '1' }])
    expect(url.value).toEqual({ a: '1', fareMax: '3', fareMin: '1' })
    expect(pq.query.value).toEqual(url.value)
  })

  it('keeps a key written again while its first navigation was in flight', async () => {
    const { url, pq } = setup()
    const first = pq.set({ fareMax: '2' })
    await nextTick()
    pq.set({ fareMax: '2.75' })
    await first
    // The first navigation landed with 2, but the newer write still reads.
    expect(url.value.fareMax).toBe('2')
    expect(pq.query.value.fareMax).toBe('2.75')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(url.value.fareMax).toBe('2.75')
  })

  it('follows the URL when it changes on its own, as with back and forward', () => {
    const { url, pq } = setup({ fareMax: '2' })
    url.value = { fareMax: '5' }
    expect(pq.query.value).toEqual({ fareMax: '5' })
  })

  it('changes the query once per write, not again when the write lands', async () => {
    const { pq } = setup({ a: '1' })
    let changes = 0
    watch(pq.query, () => { changes++ })
    await pq.set({ fareMax: '3' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(changes).toBe(1)
  })

  it('drops a write the URL never took when nothing will send it again', async () => {
    const url = ref<LocationQuery>({ fareMax: '2' })
    // A navigation that is cancelled: it resolves, but the URL stays put.
    const pq = new PendingQuery(() => url.value, async () => {})
    await pq.set({ fareMax: '3' })
    expect(pq.query.value.fareMax).toBe('2')
  })

  it('keeps a write the URL has not taken while a later flush will send it', async () => {
    const url = ref<LocationQuery>({})
    let calls = 0
    const pq = new PendingQuery(() => url.value, async (query) => {
      calls++
      if (calls > 1) {
        url.value = query as LocationQuery
      }
    })
    const first = pq.set({ fareMax: '3' })
    await nextTick()
    pq.set({ fareMin: '1' })
    await first
    expect(pq.query.value).toEqual({ fareMax: '3', fareMin: '1' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(url.value).toEqual({ fareMax: '3', fareMin: '1' })
  })

  it('logs a failed navigation instead of rejecting, and falls back to the URL', async () => {
    const url = ref<LocationQuery>({ fareMax: '2' })
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const pq = new PendingQuery(() => url.value, async () => { throw new Error('guard') })
      await expect(pq.set({ fareMax: '3' })).resolves.toBeUndefined()
      expect(pq.query.value.fareMax).toBe('2')
      expect(errors).toHaveLength(1)
    } finally {
      console.error = original
    }
  })

  it('discards writes not yet in the URL, as on back or forward', () => {
    const { url, pq } = setup({ stopBufferRadius: '400' })
    pq.set({ stopBufferRadius: '800' })
    url.value = { stopBufferRadius: '200' }
    pq.discard()
    expect(pq.query.value).toEqual({ stopBufferRadius: '200' })
  })
})
