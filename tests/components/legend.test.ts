import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import CalLegend from '~/components/cal/legend.vue'

describe('CalLegend', () => {
  it('renders properly', async () => {
    const wrapper = await mountSuspended(CalLegend)
    expect(wrapper.exists()).toBe(true)
  })
})


// import { describe, it, expect } from 'vitest'
// import { mount } from '@vue/test-utils'
// import CalLegend from '~/components/cal/legend.vue'

// describe('CalLegend', () => {
//   it('renders properly', () => {
//     const wrapper = mount(CalLegend)
//     expect(wrapper.exists()).toBe(true)
//   })
// })
