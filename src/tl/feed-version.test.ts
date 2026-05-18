import { describe, expect, it } from 'vitest'
import {
  applyFeedVersionOverrides,
  feedVersionServiceSecondsInRange,
  parseFvids,
  serializeFvids,
  type FeedGql,
  type FeedVersion,
  type FeedVersionServiceLevelRow,
} from './feed-version'

function feed (osid: string, activeFvId: number | null = null): FeedGql {
  return {
    id: osid,
    onestop_id: osid,
    feed_state: activeFvId == null
      ? null
      : { feed_version: { id: String(activeFvId), sha1: `sha-${activeFvId}`, feed: { id: 1, onestop_id: osid } } },
  }
}

function fv (id: number, osid: string): FeedVersion {
  return { id: String(id), sha1: `sha-${id}`, feed: { id: 1, onestop_id: osid } }
}

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

describe('applyFeedVersionOverrides', () => {
  it('falls back to active feed_version when no override is set', () => {
    const allFeeds = [feed('a', 10), feed('b', 20)]
    const r = applyFeedVersionOverrides(allFeeds, new Map(), new Set(), new Map())
    expect(r.feedVersions.map(f => f.id)).toEqual(['10', '20'])
    expect(r.missing).toEqual([])
  })

  it('drops excluded feeds without consulting overrides', () => {
    const allFeeds = [feed('a', 10), feed('b', 20)]
    const overrides = new Map<string, number>([['b', 99]])
    const r = applyFeedVersionOverrides(allFeeds, overrides, new Set(['b']), new Map([[99, fv(99, 'b')]]))
    expect(r.feedVersions.map(f => f.id)).toEqual(['10'])
    expect(r.missing).toEqual([])
  })

  it('swaps in resolved overrides', () => {
    const allFeeds = [feed('a', 10), feed('b', 20)]
    const overrides = new Map<string, number>([['a', 11]])
    const overrideById = new Map<number, FeedVersion>([[11, fv(11, 'a')]])
    const r = applyFeedVersionOverrides(allFeeds, overrides, new Set(), overrideById)
    expect(r.feedVersions.map(f => f.id)).toEqual(['11', '20'])
    expect(r.missing).toEqual([])
  })

  it('reports unresolved overrides as missing and skips that feed', () => {
    const allFeeds = [feed('a', 10), feed('b', 20)]
    const overrides = new Map<string, number>([['a', 999]])
    const r = applyFeedVersionOverrides(allFeeds, overrides, new Set(), new Map())
    expect(r.feedVersions.map(f => f.id)).toEqual(['20'])
    expect(r.missing).toEqual([{ onestop_id: 'a', fv_id: 999 }])
  })

  it('silently drops feeds with no active feed_version and no override', () => {
    // A bbox query can return feeds with no active FV (never imported);
    // these can't be scenario inputs, so they're dropped without warning.
    const allFeeds = [feed('a', 10), feed('b', null)]
    const r = applyFeedVersionOverrides(allFeeds, new Map(), new Set(), new Map())
    expect(r.feedVersions.map(f => f.id)).toEqual(['10'])
    expect(r.missing).toEqual([])
  })

  it('preserves input feed order', () => {
    const allFeeds = [feed('c', 30), feed('a', 10), feed('b', 20)]
    const r = applyFeedVersionOverrides(allFeeds, new Map(), new Set(), new Map())
    expect(r.feedVersions.map(f => f.feed.onestop_id)).toEqual(['c', 'a', 'b'])
  })
})

function slRow (start: string, end: string, dow: Partial<Pick<FeedVersionServiceLevelRow, 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'>> = {}): FeedVersionServiceLevelRow {
  return {
    start_date: start,
    end_date: end,
    monday: dow.monday ?? 0,
    tuesday: dow.tuesday ?? 0,
    wednesday: dow.wednesday ?? 0,
    thursday: dow.thursday ?? 0,
    friday: dow.friday ?? 0,
    saturday: dow.saturday ?? 0,
    sunday: dow.sunday ?? 0,
  }
}

describe('feedVersionServiceSecondsInRange', () => {
  it('returns 0 for empty rows', () => {
    expect(feedVersionServiceSecondsInRange([], '2018-07-09', '2018-07-15')).toBe(0)
    expect(feedVersionServiceSecondsInRange(null, '2018-07-09', '2018-07-15')).toBe(0)
  })

  it('sums a single week with mixed weekday seconds', () => {
    // 2018-07-09 was a Monday.
    const rows = [slRow('2018-07-09', '2018-07-15', { monday: 1000, wednesday: 2000, sunday: 500 })]
    expect(feedVersionServiceSecondsInRange(rows, '2018-07-09', '2018-07-15')).toBe(3500)
  })

  it('applies weekday columns across multi-week spans', () => {
    // 2018-07-09 (Mon) to 2018-07-22 (Sun) = 2 weeks. Two Mondays in range.
    const rows = [slRow('2018-07-09', '2018-07-22', { monday: 1000 })]
    expect(feedVersionServiceSecondsInRange(rows, '2018-07-09', '2018-07-22')).toBe(2000)
  })

  it('clips multi-week spans to the query window', () => {
    // 8-week span; query only one Monday.
    const rows = [slRow('2018-07-09', '2018-09-02', { monday: 1000 })]
    expect(feedVersionServiceSecondsInRange(rows, '2018-07-16', '2018-07-16')).toBe(1000)
  })

  it('skips rows that do not overlap the query window', () => {
    const rows = [
      slRow('2018-01-01', '2018-01-07', { monday: 9000 }), // out of window
      slRow('2018-07-09', '2018-07-15', { monday: 1000 }), // in window
    ]
    expect(feedVersionServiceSecondsInRange(rows, '2018-07-01', '2018-07-31')).toBe(1000)
  })

  it('respects the row.start_date weekday when not a Monday', () => {
    // 2018-07-11 = Wednesday. Row's `wednesday` column should apply to 7/11
    // (the first day), not `monday`. Single-day query confirms the alignment.
    const rows = [slRow('2018-07-11', '2018-07-17', { monday: 1000, wednesday: 30 })]
    expect(feedVersionServiceSecondsInRange(rows, '2018-07-11', '2018-07-11')).toBe(30)
  })
})
