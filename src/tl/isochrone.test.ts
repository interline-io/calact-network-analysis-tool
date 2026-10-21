import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { RouteType } from '~~/src/core'
import {
  isochroneBandColor,
  isochroneIsEmpty,
  isochroneLegend,
  isochroneMapFeatures,
  isochroneModeFromRouteTypes,
  isochroneModeParam,
  isochroneQuery,
  parseIsochronePlace,
  parseIsochroneResponse,
  type IsochroneParams,
} from './isochrone'

// Real router responses, from scripts/record-isochrone-fixtures.ts.
interface Recording {
  params: IsochroneParams
  query: string
  status: number
  body: unknown
}

function recording (name: string): Recording {
  const path = resolve(__dirname, '../../testdata/isochrone', `${name}.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function parseRecording (name: string) {
  const r = recording(name)
  return parseIsochroneResponse(r.status, typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
}

const params: IsochroneParams = {
  place: { lat: 45.5189, lon: -122.6793 },
  arriveBy: false,
  date: '2026-10-27',
  time: '08:00',
  cutoffs: [30, 15, 45],
  mode: { walkOnly: false },
  maxWalk: 800,
}

describe('isochroneQuery', () => {
  it('sends the place as fromPlace, with each cutoff repeated in order', () => {
    const q = isochroneQuery(params)
    expect(q.get('fromPlace')).toBe('45.518900,-122.679300')
    expect(q.has('toPlace')).toBe(false)
    expect(q.has('arriveBy')).toBe(false)
    expect(q.getAll('cutoff')).toEqual(['15m', '30m', '45m'])
    expect(q.get('date')).toBe('2026-10-27')
    expect(q.get('time')).toBe('08:00:00')
    expect(q.get('mode')).toBe('TRANSIT')
    expect(q.get('maxWalkingDistance')).toBe('800')
  })

  it('sends the place as toPlace for arrive-by', () => {
    const q = isochroneQuery({ ...params, arriveBy: true })
    expect(q.get('toPlace')).toBe('45.518900,-122.679300')
    expect(q.has('fromPlace')).toBe(false)
    expect(q.get('arriveBy')).toBe('true')
  })

  it('always routes on the schedule, on the date asked for, without walkingSpeed', () => {
    const q = isochroneQuery(params)
    expect(q.get('ignoreRealtimeUpdates')).toBe('true')
    expect(q.get('useFallbackDates')).toBe('false')
    expect(q.has('walkingSpeed')).toBe(false)
  })

  it('leaves rendering knobs to the router unless set', () => {
    expect(isochroneQuery(params).has('cellSize')).toBe(false)
    const q = isochroneQuery(params, { cellSize: 50, expansion: 'disk', smooth: undefined })
    expect(q.get('cellSize')).toBe('50')
    expect(q.get('expansion')).toBe('disk')
    expect(q.has('smooth')).toBe(false)
  })

  it('matches what the fixtures were recorded with', () => {
    const r = recording('leaving-from')
    expect(isochroneQuery(r.params).toString()).toBe(r.query)
  })
})

describe('isochroneModeParam', () => {
  it('is TRANSIT for every route type, named or not', () => {
    expect(isochroneModeParam({ walkOnly: false })).toBe('TRANSIT')
    expect(isochroneModeParam({ walkOnly: false, routeTypes: [4, 3, 2, 1, 0] })).toBe('TRANSIT')
  })

  it('names the router subtype of each route type', () => {
    expect(isochroneModeParam({ walkOnly: false, routeTypes: [RouteType.Bus, RouteType.LightRail] })).toBe('TRANSIT,tram,bus')
    expect(isochroneModeParam({ walkOnly: false, routeTypes: [RouteType.Subway, RouteType.IntercityRail, RouteType.Ferry] })).toBe('TRANSIT,subway,rail,ferry')
  })

  it('is WALK for walking alone, or no route type', () => {
    expect(isochroneModeParam({ walkOnly: true })).toBe('WALK')
    expect(isochroneModeParam({ walkOnly: false, routeTypes: [] })).toBe('WALK')
  })
})

describe('isochroneModeFromRouteTypes', () => {
  it('follows the scenario route type filter', () => {
    expect(isochroneModeFromRouteTypes(undefined)).toEqual({ walkOnly: false })
    expect(isochroneModeFromRouteTypes([])).toEqual({ walkOnly: true })
    expect(isochroneModeFromRouteTypes([3, 0])).toEqual({ walkOnly: false, routeTypes: [0, 3] })
  })
})

describe('parseIsochroneResponse', () => {
  it('reads bands shortest first, colored darkest first', () => {
    const result = parseRecording('leaving-from')
    expect(result.error).toBeUndefined()
    const bands = result.bands!
    expect(bands.map(b => b.minutes)).toEqual([15, 30, 45])
    expect(bands.map(b => b.color)).toEqual([isochroneBandColor(0, 3), isochroneBandColor(1, 3), isochroneBandColor(2, 3)])
    for (const b of bands) {
      expect(b.feature.geometry.type).toBe('MultiPolygon')
      expect(b.feature.properties.fill).toBe(b.color)
    }
    expect(isochroneIsEmpty(bands)).toBe(false)
  })

  it('reads arrive-by, walk-only and route-type-limited reach', () => {
    for (const name of ['arriving-at', 'walk-only', 'bus-only']) {
      const result = parseRecording(name)
      expect(result.error, name).toBeUndefined()
      expect(result.bands!.map(b => b.minutes), name).toEqual([...recording(name).params.cutoffs].sort((a, b) => a - b))
    }
  })

  it('reaches less with no service than with service', () => {
    // With fallback dates off, a date before every feed has only walking.
    const none = parseRecording('no-service')
    expect(none.error).toBeUndefined()
    const served = parseRecording('leaving-from')
    const size = (r: typeof none) => JSON.stringify(r.bands!.at(-1)!.feature.geometry).length
    expect(size(none)).toBeLessThan(size(served))
  })

  it('reports the router error for a bad request', () => {
    const r = recording('bad-date')
    expect(r.status).toBe(400)
    const result = parseRecording('bad-date')
    expect(result.bands).toBeUndefined()
    expect(result.error).toMatch(/date/i)
  })

  it('reports a non-JSON error page by status', () => {
    expect(parseIsochroneResponse(502, '<html>Bad gateway</html>')).toEqual({ error: 'Travel time request failed (HTTP 502)' })
  })

  it('reads an empty collection as nothing reachable', () => {
    const result = parseIsochroneResponse(200, JSON.stringify({ type: 'FeatureCollection', features: [] }))
    expect(result.bands).toEqual([])
    expect(isochroneIsEmpty(result.bands!)).toBe(true)
  })
})

describe('band display', () => {
  it('draws longest first, and lists shortest first', () => {
    const bands = parseRecording('leaving-from').bands!
    expect(isochroneMapFeatures(bands).map(f => f.properties.time)).toEqual([2700, 1800, 900])
    expect(isochroneLegend(bands).map(r => r.label)).toEqual(['Within 15 min', 'Within 30 min', 'Within 45 min'])
  })

  it('spans the ramp whatever the band count', () => {
    expect(isochroneBandColor(0, 1)).toBe('#08306b')
    expect(isochroneBandColor(0, 2)).toBe('#08306b')
    expect(isochroneBandColor(1, 2)).toBe('#6baed6')
  })
})

describe('parseIsochronePlace', () => {
  it('reads lat,lon and refuses anything else', () => {
    expect(parseIsochronePlace('45.5,-122.6')).toEqual({ lat: 45.5, lon: -122.6 })
    expect(parseIsochronePlace('45.5')).toBeUndefined()
    expect(parseIsochronePlace('abc,def')).toBeUndefined()
    expect(parseIsochronePlace('95,0')).toBeUndefined()
    expect(parseIsochronePlace(undefined)).toBeUndefined()
  })
})
