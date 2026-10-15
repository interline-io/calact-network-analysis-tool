import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
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
})
