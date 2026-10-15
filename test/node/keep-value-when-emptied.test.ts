import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { keepValueWhenEmptied } from '../../app/composables/keepValueWhenEmptied'

describe('keepValueWhenEmptied', () => {
  it('sets typed numbers, including 0, and keeps the value when the field is emptied', () => {
    const fareMax = ref<number | undefined>(2.5)
    const set = keepValueWhenEmptied(fareMax)
    set(undefined)
    expect(fareMax.value).toBe(2.5)
    set(3)
    expect(fareMax.value).toBe(3)
    set(0)
    expect(fareMax.value).toBe(0)
    // A negative is ignored like an emptied field.
    set(-1)
    expect(fareMax.value).toBe(0)
  })
})
