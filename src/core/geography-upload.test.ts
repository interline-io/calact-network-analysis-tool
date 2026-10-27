import { describe, expect, it } from 'vitest'
import {
  parseGeographyUpload,
  processUpload,
  roundGeometry,
  suggestUploadName,
  UploadError,
  uploadFeatureCollection,
} from './geography-upload'
import { collectPolygons, hasSearchArea, parseBbox, polygonBbox, queryAreaVariables, stopLocationFilter } from './geom'

// A square ring with its corner at (lon, lat), `size` degrees on a side
function square (lon: number, lat: number, size = 0.1): GeoJSON.Position[][] {
  return [[[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]]]
}

function collection (...features: { name?: string, coordinates: GeoJSON.Position[][], extra?: Record<string, unknown> }[]) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: features.map(f => ({
      type: 'Feature',
      properties: { OBJECTID: Math.random(), ...(f.name ? { district_name: f.name } : {}), ...f.extra },
      geometry: { type: 'Polygon', coordinates: f.coordinates },
    })),
  })
}

describe('parseGeographyUpload', () => {
  it('keeps polygon features, named by the property that names them', () => {
    const parsed = parseGeographyUpload(collection(
      { name: 'Touchet', coordinates: square(-118.7, 46.0) },
      { name: 'Prescott', coordinates: square(-118.4, 46.3) },
    ))
    expect(parsed.nameProperty).toBe('district_name')
    expect(parsed.features.map(f => f.name)).toEqual(['Touchet', 'Prescott'])
    expect(parsed.skipped).toBe(0)
  })

  it('numbers features with nothing to name them', () => {
    const parsed = parseGeographyUpload(collection({ coordinates: square(-122.7, 45.5) }))
    expect(parsed.features[0]!.name).toBe('Feature 1')
  })

  it('reads a bare Polygon or MultiPolygon', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square(-122.7, 45.5), square(-122.5, 45.5)] }
    const parsed = parseGeographyUpload(JSON.stringify(multi))
    expect(parsed.features).toHaveLength(1)
    expect(parsed.features[0]!.geometry.type).toBe('MultiPolygon')
  })

  it('skips points and lines', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-122.7, 45.5] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: square(-122.7, 45.5) } },
      ],
    })
    const parsed = parseGeographyUpload(text)
    expect(parsed.features).toHaveLength(1)
    expect(parsed.skipped).toBe(1)
  })

  it('accepts the CRS84 name ArcGIS exports with', () => {
    const fc = JSON.parse(collection({ coordinates: square(-122.7, 45.5) }))
    fc.crs = { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }
    expect(parseGeographyUpload(JSON.stringify(fc)).features).toHaveLength(1)
  })

  it.each([
    ['not JSON', 'not json at all', /valid JSON/],
    ['no polygons', JSON.stringify({ type: 'Point', coordinates: [0, 0] }), /isn't GeoJSON/],
    ['an empty collection', JSON.stringify({ type: 'FeatureCollection', features: [] }), /no polygons/],
    ['a projected crs', JSON.stringify({ ...JSON.parse(collection({ coordinates: square(-122.7, 45.5) })), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::2927' } } }), /EPSG::2927/],
    ['projected coordinates', collection({ coordinates: square(1200000, 300000, 1000) }), /aren't longitude and latitude/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseGeographyUpload(text)).toThrow(UploadError)
    expect(() => parseGeographyUpload(text)).toThrow(message)
  })
})

describe('processUpload', () => {
  const opts = { trimPrecision: false, simplify: false }

  it('combines the chosen features into one MultiPolygon', () => {
    const parsed = parseGeographyUpload(collection(
      { name: 'A', coordinates: square(-122.7, 45.5) },
      { name: 'B', coordinates: square(-122.5, 45.5) },
    ))
    const result = processUpload(parsed.features, opts)
    expect(result.polygon.type).toBe('MultiPolygon')
    expect(result.polygon.coordinates).toHaveLength(2)
    expect(result.vertexCount).toBe(10)
  })

  it('trims coordinates without leaving repeated positions', () => {
    // Two positions a few cm apart round to the same point
    const ring = [[-122.7, 45.5], [-122.6, 45.5], [-122.6000001, 45.5000001], [-122.6, 45.6], [-122.7, 45.6], [-122.7, 45.5]]
    const parsed = parseGeographyUpload(collection({ name: 'A', coordinates: [ring] }))
    const result = processUpload(parsed.features, { trimPrecision: true, simplify: false })
    expect(result.vertexCount).toBe(5)
  })

  it('simplifies away detail finer than the tolerance', () => {
    // A side with a 1 m wobble every 0.001°
    const side: GeoJSON.Position[] = []
    for (let i = 0; i <= 100; i++) {
      side.push([-122.7 + i * 0.001, 45.5 + (i % 2) * 0.00001])
    }
    const ring = [...side, [-122.6, 45.6], [-122.7, 45.6], [-122.7, 45.5]]
    const parsed = parseGeographyUpload(collection({ name: 'A', coordinates: [ring] }))
    const result = processUpload(parsed.features, { trimPrecision: true, simplify: true })
    expect(result.originalVertexCount).toBe(104)
    expect(result.vertexCount).toBeLessThan(20)
  })

  it('simplifies a shared border once, so neighbors still meet', () => {
    // West and East share a wobbly border along lon -122.6
    const border: GeoJSON.Position[] = []
    for (let i = 0; i <= 100; i++) {
      border.push([-122.6 + (i % 2) * 0.00001, 45.5 + i * 0.001])
    }
    const west = [[[-122.7, 45.5], ...border, [-122.7, 45.6], [-122.7, 45.5]]]
    const east = [[...border, [-122.5, 45.6], [-122.5, 45.5], border[0]!]]
    const parsed = parseGeographyUpload(collection({ name: 'West', coordinates: west }, { name: 'East', coordinates: east }))
    const result = processUpload(parsed.features, { trimPrecision: true, simplify: true })
    const onBorder = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon) => {
      const ring = g.type === 'Polygon' ? g.coordinates[0]! : g.coordinates[0]![0]!
      return ring.filter(([lon]) => Math.abs(lon! + 122.6) < 0.001).map(p => p.join(',')).sort()
    }
    const westBorder = onBorder(result.features[0]!.geometry)
    expect(westBorder.length).toBeLessThan(50)
    expect(new Set(westBorder)).toEqual(new Set(onBorder(result.features[1]!.geometry)))
  })
})

describe('roundGeometry', () => {
  it('rounds positions, drops a third coordinate and repeated points', () => {
    const ring = [[-122.123456, 45.123456, 10], [-122.0, 45.1234561], [-122.0, 45.2], [-122.1, 45.2], [-122.123456, 45.123456]]
    const g = roundGeometry({ type: 'Polygon', coordinates: [ring] }, 2)
    expect(g).toEqual({ type: 'Polygon', coordinates: [[[-122.12, 45.12], [-122, 45.12], [-122, 45.2], [-122.1, 45.2], [-122.12, 45.12]]] })
  })

  it('drops rings rounding leaves too small, keeping the geometry if all are', () => {
    const tiny = square(-122.5, 45.5, 0.000001)
    const multi: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [square(-122.7, 45.5), tiny] }
    expect((roundGeometry(multi, 5) as GeoJSON.MultiPolygon).coordinates).toHaveLength(1)
    const onlyTiny: GeoJSON.Polygon = { type: 'Polygon', coordinates: tiny }
    expect(roundGeometry(onlyTiny, 5)).toBe(onlyTiny)
  })
})

describe('upload names and documents', () => {
  it('names an upload after its one feature, or the file', () => {
    const one = parseGeographyUpload(collection({ name: 'Walla Walla', coordinates: square(-118.4, 46.0) })).features
    expect(suggestUploadName('districts.geojson', one)).toBe('Walla Walla')
    const unnamed = parseGeographyUpload(collection({ coordinates: square(-118.4, 46.0) })).features
    expect(suggestUploadName('districts.geojson', unnamed)).toBe('districts')
  })

  it('keeps each feature\'s properties and name in the saved collection', () => {
    const features = parseGeographyUpload(collection({ name: 'A', coordinates: square(-122.7, 45.5), extra: { code: 7 } })).features
    const fc = uploadFeatureCollection(features)
    expect(fc.features[0]!.properties).toMatchObject({ name: 'A', district_name: 'A', code: 7 })
  })
})

describe('polygon query areas', () => {
  const polygon: GeoJSON.MultiPolygon = { type: 'MultiPolygon', coordinates: [square(-122.7, 45.5), square(-122.5, 45.4)] }
  const bbox = parseBbox('-123,45,-122,46')

  it('outranks geography ids and the bbox', () => {
    expect(hasSearchArea({ polygon })).toBe(true)
    expect(hasSearchArea({ polygon: { type: 'MultiPolygon', coordinates: [] } })).toBe(false)
    const area = queryAreaVariables({ bbox, geographyIds: [1], polygon })
    expect(area.bbox).toBeUndefined()
    expect(area.geographyIds).toBeUndefined()
    expect(area.polygons).toEqual([
      { type: 'Polygon', coordinates: square(-122.7, 45.5) },
      { type: 'Polygon', coordinates: square(-122.5, 45.4) },
    ])
    expect(queryAreaVariables({ bbox, geographyIds: [1] }).polygons).toBeUndefined()
  })

  it('filters stops by the whole polygon as one feature', () => {
    const location = stopLocationFilter({ bbox, polygon })
    expect(location.bbox).toBeUndefined()
    expect(location.features).toEqual([{ type: 'Feature', id: 'query-area', properties: {}, geometry: polygon }])
    expect(stopLocationFilter({ bbox }).features).toBeUndefined()
  })

  it('bounds the polygon', () => {
    const b = polygonBbox(polygon)!
    expect([b.sw.lon, b.sw.lat, b.ne.lon, b.ne.lat]).toEqual([-122.7, 45.4, -122.4, 45.6])
    expect(polygonBbox(undefined)).toBeUndefined()
  })

  it('collects clipped outlines without merging them', () => {
    const a = { type: 'Polygon', coordinates: square(-122.7, 45.5) }
    const b = { type: 'MultiPolygon', coordinates: [square(-122.5, 45.4)] }
    expect(collectPolygons(a, b)).toEqual({ type: 'MultiPolygon', coordinates: [square(-122.7, 45.5), square(-122.5, 45.4)] })
    expect(collectPolygons(undefined, b)).toBe(b)
    expect(collectPolygons(a, undefined)).toBe(a)
  })
})
