import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import type { LocationQuery } from 'vue-router'
import { PendingQuery, querySource } from '../../app/composables/pendingQuery'
import { createScenarioParams } from '../../app/composables/scenarioParams'

// A parameter set over a query held in memory rather than in the URL.
function setup (initial: LocationQuery = {}) {
  const store = ref<LocationQuery>(initial)
  const pq = new PendingQuery(() => store.value, async (query) => {
    store.value = query as LocationQuery
  })
  return { store, params: createScenarioParams(querySource(pq)) }
}

// Lets pending writes reach their store.
function settle () {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('createScenarioParams', () => {
  it('writes each set to its own query', async () => {
    const a = setup()
    const b = setup()
    a.params.inputs.stopBufferRadius.value = 400
    a.params.filters.fareMax.value = 2.5
    a.params.display.aggregateLayer.value = 'county'
    expect(a.params.inputs.stopBufferRadius.value).toBe(400)
    expect(a.params.filters.fareMax.value).toBe(2.5)
    expect(a.params.display.aggregateLayer.value).toBe('county')

    await settle()
    expect(a.store.value).toEqual({ stopBufferRadius: '400', fareMax: '2.5', aggregateLayer: 'county' })
    expect(b.store.value).toEqual({})
    expect(b.params.filters.fareMax.value).toBeUndefined()
    expect(b.params.display.aggregateLayer.value).toBe('tract')
  })

  it('derives values across inputs, filters and display from one query', () => {
    const a = setup({ startTime: '07:00:00', aggregateLayer: 'county' })
    const b = setup()
    // isAllDayMode is display state read from the time filters, and the
    // buffer layer input falls back to the display's aggregation layer.
    expect(a.params.display.isAllDayMode.value).toBe(false)
    expect(a.params.inputs.stopBufferLayer.value).toBe('county')
    expect(b.params.display.isAllDayMode.value).toBe(true)
    expect(b.params.inputs.stopBufferLayer.value).toBe('tract')
  })
})
