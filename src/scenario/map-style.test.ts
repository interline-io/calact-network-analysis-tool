import { describe, it, expect } from 'vitest'
import { buildStyleData, visibleAgencyIds, type BuildStyleDataParams } from './map-style'

// Minimal Route-shaped object; the matchers read these fields off `v` directly
// (Route inputs don't need the stop/route lookups), so a light cast is enough.
function route (fields: Record<string, any>): any {
  return { __typename: 'Route', ...fields }
}
function stop (fields: Record<string, any>): any {
  return { __typename: 'Stop', route_stops: [], ...fields }
}

const noAgencies = { agencies: [], agencyColorScale: () => '#000' }

describe('buildStyleData', () => {
  it('returns only a catchall "Other" rule for Service area mode', () => {
    const rules = buildStyleData({ scenarioFilterResult: undefined, dataDisplayMode: 'Service area', ...noAgencies })
    expect(rules).toHaveLength(1)
    expect(rules[0]!.label).toBe('Other')
    expect(rules[0]!.match(route({}))).toBe(true)
  })

  describe('Route frequency mode', () => {
    const rules = buildStyleData({ scenarioFilterResult: undefined, dataDisplayMode: 'Route frequency', ...noAgencies })

    it('exposes the five headway buckets in order', () => {
      expect(rules.slice(0, 5).map(r => r.label)).toEqual([
        '40+ mins', '30-39 mins', '20-29 mins', '10-19 mins', '0-9 mins',
      ])
    })

    it('matches a route to the first bucket whose threshold it clears (cumulative >=)', () => {
      // headway is compared in seconds (mins * 60); larger headway = less frequent.
      const infrequent = route({ average_frequency: 2400 }) // 40 min headway
      const frequent = route({ average_frequency: 600 }) // 10 min headway
      expect(rules.find(r => r.match(infrequent))!.label).toBe('40+ mins')
      expect(rules.find(r => r.match(frequent))!.label).toBe('10-19 mins')
    })
  })

  describe('Stop visits mode', () => {
    const rules = buildStyleData({ scenarioFilterResult: undefined, dataDisplayMode: 'Stop visits', ...noAgencies })

    it('matches a stop to the first visit bucket it clears', () => {
      const busy = stop({ visits: { total: { visit_average: 100 } } })
      const quiet = stop({ visits: { total: { visit_average: 12 } } })
      expect(rules.find(r => r.match(busy))!.label).toBe('100+ visits')
      expect(rules.find(r => r.match(quiet))!.label).toBe('10-20 visits')
    })
  })

  describe('Agency mode', () => {
    it('builds a rule per agency and matches by numeric agency id', () => {
      const agencies = [
        { id: 'AC', numericId: 1, name: 'AC Transit' },
        { id: 'BART', numericId: 2, name: 'BART' },
      ]
      const rules = buildStyleData({
        scenarioFilterResult: undefined,
        dataDisplayMode: 'Agency',
        agencies,
        agencyColorScale: key => `color-${key}`,
      })
      expect(rules.find(r => r.label === 'AC Transit')!.color).toBe('color-1')
      const acRoute = route({ agency: { id: 1 } })
      expect(rules.find(r => r.match(acRoute))!.label).toBe('AC Transit')
      // A stop answers from its route_stops rows, with no routes phase needed.
      const acStop = stop({ route_stops: [{ route_id: 10, agency_id: 2 }] })
      expect(rules.find(r => r.match(acStop))!.label).toBe('BART')
      // Below the categorical-palette size there is no "Other" catchall, so an
      // unknown agency matches nothing.
      const otherRoute = route({ agency: { id: 99 } })
      expect(rules.find(r => r.match(otherRoute))).toBeUndefined()
    })

    // Issue #473: an agency with no marked route has nothing left on the map
    // once filtered features are hidden, so it should not hold a legend row.
    const threeAgencies = [
      { id: 'AC', numericId: 1, name: 'AC Transit' },
      { id: 'BART', numericId: 2, name: 'BART' },
      { id: 'SF', numericId: 3, name: 'Muni' },
    ]
    // Mirrors d3's scaleOrdinal, which map.vue uses: a color is claimed by
    // position in the domain the scale was built over, not by the key. A stub
    // that keys off the id alone cannot catch a scale built over a filtered
    // list, which is the regression these cases exist to pin.
    function positionalScale (domain: string[]): (key: string) => string {
      const claimed = new Map(domain.map((key, i) => [key, `color-${i}`]))
      return key => claimed.get(key) ?? 'color-none'
    }

    const build = (extra: Partial<BuildStyleDataParams>) => buildStyleData({
      scenarioFilterResult: undefined,
      dataDisplayMode: 'Agency',
      agencies: threeAgencies,
      agencyColorScale: positionalScale(threeAgencies.map(a => String(a.numericId))),
      ...extra,
    })

    it('drops unmarked agencies while the survivors keep their colors', () => {
      const all = build({})
      const filtered = build({ hideUnmarked: true, markedAgencyIds: new Set([1, 3]) })
      expect(filtered.map(r => r.label)).toEqual(['AC Transit', 'Muni'])
      // Colors are claimed over the full agency list, so removing BART does not
      // shift Muni onto BART's color. Muni holds the third slot either way.
      for (const label of ['AC Transit', 'Muni']) {
        expect(filtered.find(r => r.label === label)!.color)
          .toBe(all.find(r => r.label === label)!.color)
      }
      expect(filtered.find(r => r.label === 'Muni')!.color).toBe('color-2')
    })

    it('leaves a dropped agency\'s features to be colored by whoever else serves them', () => {
      const filtered = build({ hideUnmarked: true, markedAgencyIds: new Set([1]) })
      // A stop only BART serves matches nothing now, so the map draws it in the
      // background color rather than BART's.
      const bartOnly = stop({ route_stops: [{ route_id: 20, agency_id: 2 }] })
      expect(filtered.find(r => r.match(bartOnly))).toBeUndefined()
      // A stop shared with AC Transit is still colored, by AC Transit.
      const shared = stop({ route_stops: [{ route_id: 20, agency_id: 2 }, { route_id: 10, agency_id: 1 }] })
      expect(filtered.find(r => r.match(shared))!.label).toBe('AC Transit')
    })

    it('keeps every agency when filtered features are still drawn', () => {
      const rules = build({ hideUnmarked: false, markedAgencyIds: new Set([1]) })
      expect(rules.map(r => r.label)).toEqual(['AC Transit', 'BART', 'Muni'])
    })

    // The routes phase lands before the departures a frequency filter needs, so
    // for that whole window the marks are unknown. The caller leaves the set out
    // until they exist, or the legend empties out mid-load.
    it('keeps every agency while the marks are unknown', () => {
      const rules = build({ hideUnmarked: true })
      expect(rules.map(r => r.label)).toEqual(['AC Transit', 'BART', 'Muni'])
    })

    // A set that is present but empty is a different state: the filters ran and
    // matched nothing, so nothing should be listed as drawn.
    it('drops every agency when the filters matched nothing', () => {
      const rules = build({ hideUnmarked: true, markedAgencyIds: new Set<number>() })
      expect(rules.map(r => r.label)).toEqual(['Other'])
    })

    it('adds the "Other" catchall based on the agency count, not the survivors', () => {
      const many = Array.from({ length: 12 }, (_, i) => ({ id: `A${i}`, numericId: i, name: `Agency ${i}` }))
      const rules = buildStyleData({
        scenarioFilterResult: undefined,
        dataDisplayMode: 'Agency',
        agencies: many,
        agencyColorScale: positionalScale(many.map(a => String(a.numericId))),
        hideUnmarked: true,
        markedAgencyIds: new Set([0, 1]),
      })
      // Two survivors of the ten that hold palette slots, plus the catchall the
      // full list earns — agencies 10 and 11 never had a rule of their own.
      expect(rules.map(r => r.label)).toEqual(['Agency 0', 'Agency 1', 'Other'])
    })
  })
})

describe('visibleAgencyIds', () => {
  const ids = [1, 2, 3]

  it('keeps every agency while the marks are unknown', () => {
    expect(visibleAgencyIds(ids, undefined, true)).toEqual(ids)
  })

  it('keeps every agency when filtered features are still drawn', () => {
    expect(visibleAgencyIds(ids, new Set([1]), false)).toEqual(ids)
  })

  it('keeps only the agencies that survived', () => {
    expect(visibleAgencyIds(ids, new Set([1, 3]), true)).toEqual([1, 3])
  })

  // What hides a transfer hub: nothing it serves is left on the map.
  it('returns nothing when the filters matched none of them', () => {
    expect(visibleAgencyIds(ids, new Set<number>(), true)).toEqual([])
    expect(visibleAgencyIds(ids, new Set([9]), true)).toEqual([])
  })
})
