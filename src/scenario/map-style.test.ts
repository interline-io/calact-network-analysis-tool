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
      // headway is compared in seconds (mins * 60).
      const fast = route({ average_frequency: 2400 }) // 40 min
      const mid = route({ average_frequency: 600 }) // 10 min
      expect(rules.find(r => r.match(fast))!.label).toBe('40+ mins')
      expect(rules.find(r => r.match(mid))!.label).toBe('10-19 mins')
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
    it('builds a rule per agency and matches a route by agency_id', () => {
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
      const acRoute = route({ agency: { agency_id: 'AC' } })
      expect(rules.find(r => r.match(acRoute))!.label).toBe('AC Transit')
      // Below the categorical-palette size there is no "Other" catchall, so an
      // unknown agency matches nothing.
      const otherRoute = route({ agency: { agency_id: 'UNKNOWN' } })
      expect(rules.find(r => r.match(otherRoute))).toBeUndefined()
    })
  })
})
