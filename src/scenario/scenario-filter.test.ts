import { describe, it, expect } from 'vitest'
import { applyScenarioResultFilter } from './scenario-filter'
import { StopDepartureCache } from '../tl/departure-cache'
import { FlexDepartureCache } from '../tl/flex-departure-cache'
import type { ScenarioData, ScenarioConfig, ScenarioFilter } from './scenario'
import type { FlexAreaFeature } from '../tl/flex'

// Minimal ScenarioConfig covering a Mon–Fri week (2024-01-15 Mon to 2024-01-19 Fri)
const baseConfig: ScenarioConfig = {
  reportName: 'test',
  startDate: new Date('2024-01-15T00:00:00'),
  endDate: new Date('2024-01-19T00:00:00'),
  geoDatasetName: 'test',
}

// Minimal FlexAreaFeature factory
function makeFlexFeature (id: number, agencyName = 'Test Agency'): FlexAreaFeature {
  return {
    type: 'Feature',
    id: `feed:loc-${id}`,
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: {
      internal_id: id,
      location_id: `loc-${id}`,
      agencies: [{ agency_id: `agency-${id}`, agency_name: agencyName }],
      agency_ids: [`agency-${id}`],
      routes: [],
      route_ids: [],
      route_types: [],
      pickup_available: true,
      pickup_types: [2],
      pickup_booking_rule_ids: [],
      pickup_booking_rules: [],
      drop_off_available: false,
      drop_off_types: [],
      drop_off_booking_rule_ids: [],
      drop_off_booking_rules: [],
    },
  }
}

// Helper to build a FlexDepartureCache from (locationId, date) pairs
function makeFlexCache (entries: Array<[locationId: number, date: string]>): FlexDepartureCache {
  const cache = new FlexDepartureCache()
  for (const [id, date] of entries) {
    cache.add(id, date)
  }
  return cache
}

// Minimal ScenarioData
function makeData (flexAreas: FlexAreaFeature[], flexDepartureCache = new FlexDepartureCache()): ScenarioData {
  return {
    stops: [],
    routes: [],
    feedVersions: [],
    stopDepartureCache: new StopDepartureCache(),
    flexDepartureCache,
    flexAreas,
  }
}

describe('flexAreaMarked — agency filter', () => {
  it('marks all flex areas when no agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A'), makeFlexFeature(2, 'Agency B')])
    const filter: ScenarioFilter = {}
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas.every(a => a.properties.marked)).toBe(true)
  })

  it('marks only matching agency when agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A'), makeFlexFeature(2, 'Agency B')])
    const filter: ScenarioFilter = { selectedAgencies: ['Agency A'] }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    const [a, b] = result.flexAreas
    expect(a?.properties.marked).toBe(true)
    expect(b?.properties.marked).toBe(false)
  })

  it('marks nothing when empty agency filter is active', () => {
    const data = makeData([makeFlexFeature(1, 'Agency A')])
    const filter: ScenarioFilter = { selectedAgencies: [] }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas.every(a => !a.properties.marked)).toBe(true)
  })
})

describe('flexAreaMarked — day-of-week filter', () => {
  // 2024-01-15 = Monday, 2024-01-16 = Tuesday, 2024-01-19 = Friday

  it('marks all when no weekday filter is active', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // only Monday
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = {}
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('marks area that has service on a selected weekday (Any mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // Monday
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('does not mark area that has no service on any selected weekday (Any mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-16']]) // Tuesday only
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'friday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('marks area that has service on all selected weekdays (All mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15'], [1, '2024-01-16']]) // Mon + Tue
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'tuesday'], selectedWeekdayMode: 'All' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })

  it('does not mark area missing service on one of the selected weekdays (All mode)', () => {
    const cache = makeFlexCache([[1, '2024-01-15']]) // Monday only
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday', 'tuesday'], selectedWeekdayMode: 'All' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('does not mark area with no cache entries when weekday filter is active', () => {
    const data = makeData([makeFlexFeature(1)], new FlexDepartureCache())
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, baseConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(false)
  })

  it('recognises service on either of two Mondays in the date range', () => {
    // Extend config to two weeks
    const twoWeekConfig: ScenarioConfig = {
      ...baseConfig,
      endDate: new Date('2024-01-26T00:00:00'), // second week ends Friday
    }
    // Only the second Monday (2024-01-22) has service
    const cache = makeFlexCache([[1, '2024-01-22']])
    const data = makeData([makeFlexFeature(1)], cache)
    const filter: ScenarioFilter = { selectedWeekdays: ['monday'], selectedWeekdayMode: 'Any' }
    const result = applyScenarioResultFilter(data, twoWeekConfig, filter)
    expect(result.flexAreas[0]?.properties.marked).toBe(true)
  })
})
