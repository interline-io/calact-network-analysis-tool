import { describe, it, expect } from 'vitest'
import { RouteType } from '~~/src/core'
import { isochroneRecording } from '../../test/isochrone-recordings'
import {
  ISOCHRONE_MAX_CUTOFFS,
  isochroneBandColors,
  isochroneCutoffColors,
  parseIsochroneCutoff,
  isochroneIsEmpty,
  isochroneMapFeatures,
  isochroneModeFromRouteTypes,
  isochroneModeParam,
  isochroneQuery,
  normalizeIsochroneMode,
  parseIsochronePlace,
  parseIsochroneResponse,
  type IsochroneParams,
} from './isochrone'

const recording = isochroneRecording

function parseRecording (name: string) {
  const r = recording(name)
  return parseIsochroneResponse(r.status, r.body, r.params.cutoffs)
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

describe('normalizeIsochroneMode', () => {
  it('has one form for each choice', () => {
    expect(normalizeIsochroneMode({ walkOnly: false, routeTypes: [3, 0] })).toEqual({ walkOnly: false, routeTypes: [0, 3] })
    expect(normalizeIsochroneMode({ walkOnly: false, routeTypes: [4, 3, 2, 1, 0] })).toEqual({ walkOnly: false })
    expect(normalizeIsochroneMode({ walkOnly: false, routeTypes: [] })).toEqual({ walkOnly: true })
    // Types the router doesn't know (cable tram, 5) leave nothing to ride.
    expect(normalizeIsochroneMode({ walkOnly: false, routeTypes: [5 as RouteType] })).toEqual({ walkOnly: true })
  })
})

describe('isochroneModeFromRouteTypes', () => {
  it('follows the scenario route type filter', () => {
    expect(isochroneModeFromRouteTypes(undefined)).toEqual({ walkOnly: false })
    expect(isochroneModeFromRouteTypes([])).toEqual({ walkOnly: true })
    expect(isochroneModeFromRouteTypes([3, 0])).toEqual({ walkOnly: false, routeTypes: [0, 3] })
    expect(isochroneModeFromRouteTypes([5 as RouteType])).toEqual({ walkOnly: true })
  })
})

describe('parseIsochroneResponse', () => {
  it('reads bands shortest first, colored darkest first', () => {
    const result = parseRecording('leaving-from')
    expect(result.error).toBeUndefined()
    const bands = result.bands!
    expect(bands.map(b => b.minutes)).toEqual([15, 30, 45])
    expect(bands.map(b => b.color)).toEqual([0, 1, 2].map(rank => isochroneBandColors(rank, 3).fill))
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
    expect(parseIsochroneResponse(502, '<html>Bad gateway</html>', [15])).toEqual({ error: 'Travel time request failed (HTTP 502)' })
  })

  it('colors each band as its travel time among those asked for', () => {
    // The 30 minute band went missing: the others keep their colors.
    const leaving = JSON.parse(isochroneRecording('leaving-from').body)
    const without30 = { ...leaving, features: leaving.features.filter((f: any) => f.properties.contour !== 30) }
    const bands = parseIsochroneResponse(200, JSON.stringify(without30), [15, 30, 45]).bands!
    expect(bands.map(b => b.minutes)).toEqual([15, 45])
    expect(bands.map(b => b.color)).toEqual([isochroneCutoffColors(15, [15, 30, 45]).fill, isochroneCutoffColors(45, [15, 30, 45]).fill])
    expect(bands[1]!.color).toBe(isochroneBandColors(2, 3).fill)
  })

  it('colors a band timed off a travel time asked for as the nearest one', () => {
    expect(isochroneCutoffColors(31, [15, 30, 45])).toEqual(isochroneCutoffColors(30, [15, 30, 45]))
    expect(isochroneCutoffColors(44, [15, 30, 45])).toEqual(isochroneBandColors(2, 3))
  })

  it('skips a band with no travel time', () => {
    const poly = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] }
    const body = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: poly, properties: {} },
        { type: 'Feature', geometry: poly, properties: { time: 900, contour: 15 } },
      ],
    })
    expect(parseIsochroneResponse(200, body, [15]).bands!.map(b => b.minutes)).toEqual([15])
  })

  it('reads an empty collection as nothing reachable', () => {
    const result = parseIsochroneResponse(200, JSON.stringify({ type: 'FeatureCollection', features: [] }), [15])
    expect(result.bands).toEqual([])
    expect(isochroneIsEmpty(result.bands!)).toBe(true)
  })
})

describe('band display', () => {
  it('draws longest first', () => {
    const bands = parseRecording('leaving-from').bands!
    expect(isochroneMapFeatures(bands).map(f => f.properties.time)).toEqual([2700, 1800, 900])
  })

  it('spans the ramp whatever the band count', () => {
    // d3's Greens at 1 is #00441b; at 0.5, #73c378.
    expect(isochroneBandColors(0, 1)).toEqual({ fill: 'rgb(0, 68, 27)', text: '#fff' })
    expect(isochroneBandColors(0, 2).fill).toBe('rgb(0, 68, 27)')
    expect(isochroneBandColors(1, 2)).toEqual({ fill: 'rgb(115, 195, 120)', text: '#00441b' })
  })

  it('gives every band its own shade, up to the most the router takes', () => {
    for (let total = 1; total <= ISOCHRONE_MAX_CUTOFFS; total++) {
      const fills = Array.from({ length: total }, (_, rank) => isochroneBandColors(rank, total).fill)
      expect(new Set(fills).size).toBe(total)
    }
  })
})

describe('parseIsochroneCutoff', () => {
  it('reads minutes, or hours and minutes', () => {
    expect(parseIsochroneCutoff('90')).toBe(90)
    expect(parseIsochroneCutoff('45m')).toBe(45)
    expect(parseIsochroneCutoff('2h')).toBe(120)
    expect(parseIsochroneCutoff('1h30m')).toBe(90)
    expect(parseIsochroneCutoff(' 1h 30 ')).toBe(90)
    expect(parseIsochroneCutoff('4H')).toBe(240)
  })

  it('refuses what the router would', () => {
    expect(parseIsochroneCutoff('')).toBeUndefined()
    expect(parseIsochroneCutoff('0')).toBeUndefined()
    expect(parseIsochroneCutoff('4h1m')).toBeUndefined()
    expect(parseIsochroneCutoff('1.5h')).toBeUndefined()
    expect(parseIsochroneCutoff('soon')).toBeUndefined()
  })
})

describe('parseIsochronePlace', () => {
  it('reads lat,lon and refuses anything else', () => {
    expect(parseIsochronePlace('45.5,-122.6')).toEqual({ lat: 45.5, lon: -122.6 })
    expect(parseIsochronePlace('45.5')).toBeUndefined()
    expect(parseIsochronePlace('abc,def')).toBeUndefined()
    expect(parseIsochronePlace('95,0')).toBeUndefined()
    // Number('') is 0: an empty part isn't the equator or prime meridian.
    expect(parseIsochronePlace('45.5,')).toBeUndefined()
    expect(parseIsochronePlace(',-122.6')).toBeUndefined()
    expect(parseIsochronePlace('45.5,-122.6,9')).toBeUndefined()
    expect(parseIsochronePlace(undefined)).toBeUndefined()
  })
})
