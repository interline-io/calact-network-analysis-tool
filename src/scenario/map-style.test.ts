import { describe, it, expect } from 'vitest'
import { buildStyleData } from './map-style'

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
    const build = (extra: Record<string, any>) => buildStyleData({
      scenarioFilterResult: undefined,
      dataDisplayMode: 'Agency',
      agencies: threeAgencies,
      agencyColorScale: key => `color-${key}`,
      ...extra,
    })

    it('drops unmarked agencies while the survivors keep their colors', () => {
      const all = build({})
      const filtered = build({ hideUnmarked: true, markedAgencyIds: new Set([1, 3]) })
      expect(filtered.map(r => r.label)).toEqual(['AC Transit', 'Muni'])
      // Colors are handed out over the full agency list, so removing BART does
      // not shift Muni onto BART's color.
      for (const label of ['AC Transit', 'Muni']) {
        expect(filtered.find(r => r.label === label)!.color)
          .toBe(all.find(r => r.label === label)!.color)
      }
    })

    it('keeps every agency when filtered features are still drawn', () => {
      const rules = build({ hideUnmarked: false, markedAgencyIds: new Set([1]) })
      expect(rules.map(r => r.label)).toEqual(['AC Transit', 'BART', 'Muni'])
    })

    it('keeps every agency when no marked set is supplied', () => {
      const rules = build({ hideUnmarked: true })
      expect(rules.map(r => r.label)).toEqual(['AC Transit', 'BART', 'Muni'])
    })

    it('adds the "Other" catchall based on the agency count, not the survivors', () => {
      const many = Array.from({ length: 12 }, (_, i) => ({ id: `A${i}`, numericId: i, name: `Agency ${i}` }))
      const rules = buildStyleData({
        scenarioFilterResult: undefined,
        dataDisplayMode: 'Agency',
        agencies: many,
        agencyColorScale: key => `color-${key}`,
        hideUnmarked: true,
        markedAgencyIds: new Set([0, 1]),
      })
      // Two survivors of the ten that hold palette slots, plus the catchall the
      // full list earns — agencies 10 and 11 never had a rule of their own.
      expect(rules.map(r => r.label)).toEqual(['Agency 0', 'Agency 1', 'Other'])
    })
  })
})
