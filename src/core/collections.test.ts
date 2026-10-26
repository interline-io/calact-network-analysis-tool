import { describe, it, expect } from 'vitest'
import { groupBy } from './collections'

describe('groupBy', () => {
  it('groups items by key, each group in order', () => {
    const groups = groupBy([{ k: 'a', n: 1 }, { k: 'b', n: 2 }, { k: 'a', n: 3 }], x => x.k)
    expect([...groups].map(([k, list]) => [k, list.map(x => x.n)])).toEqual([['a', [1, 3]], ['b', [2]]])
  })
})
