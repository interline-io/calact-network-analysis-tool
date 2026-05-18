import { describe, expect, it } from 'vitest'
import { parseFvids, serializeFvids } from './feed-version'

describe('parseFvids', () => {
  it('returns empty maps for empty input', () => {
    for (const v of ['', null, undefined]) {
      const r = parseFvids(v as string | null | undefined)
      expect(r.picks.size).toBe(0)
      expect(r.excluded.size).toBe(0)
    }
  })

  it('parses osid:fvid pairs into picks', () => {
    const r = parseFvids('f-9q9-bart:42,f-c20-trimet:101')
    expect(r.picks.get('f-9q9-bart')).toBe(42)
    expect(r.picks.get('f-c20-trimet')).toBe(101)
    expect(r.excluded.size).toBe(0)
  })

  it('treats osid:0 and bare osid as excluded', () => {
    const r = parseFvids('f-9q9-bart:0,f-c20-trimet')
    expect(r.picks.size).toBe(0)
    expect(r.excluded.has('f-9q9-bart')).toBe(true)
    expect(r.excluded.has('f-c20-trimet')).toBe(true)
  })

  it('exclude overrides earlier pick for the same osid', () => {
    const r = parseFvids('f-9q9-bart:42,f-9q9-bart:0')
    expect(r.picks.has('f-9q9-bart')).toBe(false)
    expect(r.excluded.has('f-9q9-bart')).toBe(true)
  })

  it('pick overrides earlier exclude for the same osid', () => {
    const r = parseFvids('f-9q9-bart:0,f-9q9-bart:42')
    expect(r.picks.get('f-9q9-bart')).toBe(42)
    expect(r.excluded.has('f-9q9-bart')).toBe(false)
  })

  it('skips malformed tokens', () => {
    const r = parseFvids(',,f-9q9-bart:42,:,bad:abc')
    expect(r.picks.get('f-9q9-bart')).toBe(42)
    // bad:abc → fvid parses NaN → treated as exclude.
    expect(r.excluded.has('bad')).toBe(true)
  })
})

describe('serializeFvids', () => {
  it('round-trips picks and excludes deterministically', () => {
    const parsed = {
      picks: new Map([
        ['z-feed', 99],
        ['a-feed', 1],
      ]),
      excluded: new Set(['m-feed']),
    }
    // Sorted: picks before excludes, alphabetic within each group.
    expect(serializeFvids(parsed)).toBe('a-feed:1,z-feed:99,m-feed:0')
  })

  it('drops picks that also appear in excludes', () => {
    const parsed = {
      picks: new Map([['a', 1]]),
      excluded: new Set(['a']),
    }
    expect(serializeFvids(parsed)).toBe('a:0')
  })

  it('round-trips through parseFvids semantically', () => {
    // Serializer rearranges picks before excludes (each alphabetical) for
    // stable URLs, so a verbatim string round-trip isn't guaranteed.
    // Equivalence is: re-parsing the serialized output yields the same maps.
    const src = 'c:42,a:1,b:0'
    const parsed = parseFvids(src)
    const reparsed = parseFvids(serializeFvids(parsed))
    expect(reparsed.picks).toEqual(parsed.picks)
    expect(reparsed.excluded).toEqual(parsed.excluded)
  })
})
