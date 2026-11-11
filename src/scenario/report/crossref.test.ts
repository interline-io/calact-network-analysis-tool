import { describe, it, expect } from 'vitest'
import {
  crossrefKey,
  crossrefReportTab,
  displayModeForReportTab,
  pageOfIndex,
  reportRowKey,
  reportRowLabel,
  reportRowTarget,
  type CrossrefTarget,
} from './crossref'

describe('reportRowTarget', () => {
  it('names a route or a stop by its numeric id', () => {
    expect(reportRowTarget('routes', { id: 12, route_id: '15' })).toEqual({ kind: 'route', id: 12 })
    expect(reportRowTarget('stops', { id: 7, stop_id: 'A' })).toEqual({ kind: 'stop', id: 7 })
  })

  it('names a cluster, a flex area and a geography by their own keys', () => {
    expect(reportRowTarget('stop-clusters', { id: 'c1' })).toEqual({ kind: 'cluster', id: 'c1' })
    expect(reportRowTarget('flex', { location_id: 'zone', feed_onestop_id: 'f-x' }))
      .toEqual({ kind: 'flex', feedOnestopId: 'f-x', locationId: 'zone' })
    expect(reportRowTarget('stops-aggregated', { geoid: '41051' })).toEqual({ kind: 'geography', geoid: '41051' })
  })

  it('names nothing for a row missing its id', () => {
    expect(reportRowTarget('routes', {})).toBeUndefined()
    expect(reportRowTarget('stops', { id: 'x' })).toBeUndefined()
    expect(reportRowTarget('flex', { location_id: 'zone' })).toBeUndefined()
    expect(reportRowTarget('stops-aggregated', {})).toBeUndefined()
  })

  it('names nothing in a table without map features', () => {
    expect(reportRowTarget('agencies', { id: 3 })).toBeUndefined()
    expect(reportRowTarget('transfers', { id: 3 })).toBeUndefined()
  })
})

describe('crossref keys', () => {
  // A target found on the map must find its row, and a row's target its
  // feature, so each kind round-trips through its table.
  const targets: CrossrefTarget[] = [
    { kind: 'route', id: 12 },
    { kind: 'stop', id: 7 },
    { kind: 'cluster', id: 'c1' },
    { kind: 'flex', feedOnestopId: 'f-x', locationId: 'zone' },
    { kind: 'geography', geoid: '41051' },
  ]
  const rows: Record<string, any>[] = [
    { id: 12 },
    { id: 7 },
    { id: 'c1' },
    { location_id: 'zone', feed_onestop_id: 'f-x' },
    { geoid: '41051' },
  ]

  it('gives a target the key of its table row', () => {
    targets.forEach((target, i) => {
      const tab = crossrefReportTab(target)
      expect(reportRowKey(tab, rows[i]!)).toBe(crossrefKey(target))
      expect(reportRowTarget(tab, rows[i]!)).toEqual(target)
    })
  })

  it('keeps flex areas with the same location id in different feeds apart', () => {
    expect(crossrefKey({ kind: 'flex', feedOnestopId: 'f-a', locationId: 'zone' }))
      .not.toBe(crossrefKey({ kind: 'flex', feedOnestopId: 'f-b', locationId: 'zone' }))
  })
})

describe('reportRowLabel', () => {
  it('names a row as its table does, falling back to its id', () => {
    expect(reportRowLabel('routes', { route_name: '15 Belmont', route_id: '15' })).toBe('15 Belmont')
    expect(reportRowLabel('routes', { route_name: '', route_id: '15' })).toBe('15')
    expect(reportRowLabel('stops', { stop_name: 'SW Alder & 18th', stop_id: '13918' })).toBe('SW Alder & 18th')
    expect(reportRowLabel('stops-aggregated', { geoid: '41051' })).toBe('41051')
    expect(reportRowLabel('agencies', { agency_name: 'TriMet' })).toBeUndefined()
  })
})

describe('displayModeForReportTab', () => {
  it('switches the map to the mode that draws the table\'s features', () => {
    expect(displayModeForReportTab('stops', 'Transit mode')).toBe('Stop visits')
    expect(displayModeForReportTab('stop-clusters', 'Agency')).toBe('Stop visits')
    expect(displayModeForReportTab('flex', 'Transit mode')).toBe('Service area')
    expect(displayModeForReportTab('routes', 'Stop visits')).toBe('Transit mode')
  })

  it('keeps a mode that already draws them', () => {
    expect(displayModeForReportTab('stops-aggregated', 'Stop visits')).toBeUndefined()
    expect(displayModeForReportTab('routes', 'Route frequency')).toBeUndefined()
    expect(displayModeForReportTab('transfers', 'Agency')).toBeUndefined()
  })
})

describe('pageOfIndex', () => {
  it('counts pages from 1', () => {
    expect(pageOfIndex(0, 20)).toBe(1)
    expect(pageOfIndex(19, 20)).toBe(1)
    expect(pageOfIndex(20, 20)).toBe(2)
    expect(pageOfIndex(45, 20)).toBe(3)
  })
})
