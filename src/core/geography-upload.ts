// Reading an uploaded GeoJSON file into a query area (#477).
//
// Turf and TopoJSON run here only to check an upload and to make it smaller
// (trimming coordinate precision and simplifying), as the user can turn off.
// They never compute results that need to agree with PostGIS: the server clips
// and measures the cleaned polygon like any other query area.

import area from '@turf/area'
import intersect from '@turf/intersect'
import kinks from '@turf/kinks'
import { feature as topoFeature } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify } from 'topojson-simplify'
import { UPLOAD_COORDINATE_PRECISION, UPLOAD_SIMPLIFY_MIN_WEIGHT } from './constants'
import { polygonBbox, type QueryPolygon } from './geom'

export type PolygonalGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon

// One polygon feature from an upload
export interface UploadFeature {
  // Position among the file's polygon features
  index: number
  name: string
  geometry: PolygonalGeometry
  properties: Record<string, unknown>
}

export interface ParsedUpload {
  features: UploadFeature[]
  // The property the feature names came from, if any
  nameProperty?: string
  // Features that aren't polygons (points, lines, empty geometries)
  skipped: number
}

export interface UploadProcessOptions {
  trimPrecision: boolean
  simplify: boolean
}

export const DEFAULT_UPLOAD_PROCESS_OPTIONS: UploadProcessOptions = { trimPrecision: true, simplify: true }

export interface ProcessedUpload {
  polygon: QueryPolygon
  features: UploadFeature[]
  vertexCount: number
  // Before trimming and simplifying
  originalVertexCount: number
  // Problems that keep the area from being used
  errors: string[]
}

// A problem with the file itself, with a message for the user
export class UploadError extends Error {}

// CRS names that mean WGS84 longitude/latitude, as GeoJSON requires
const WGS84_CRS = /^(urn:ogc:def:crs:OGC:1\.3:CRS84|urn:ogc:def:crs:EPSG::4326|EPSG:4326|CRS84)$/i

// Parses an uploaded file's text, keeping its polygon features
export function parseGeographyUpload (text: string): ParsedUpload {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    throw new UploadError('This file isn\'t valid JSON. Upload a GeoJSON file.')
  }
  if (!json || typeof json !== 'object') {
    throw new UploadError('This file isn\'t GeoJSON.')
  }

  const crsName = json.crs?.properties?.name
  if (typeof crsName === 'string' && !WGS84_CRS.test(crsName)) {
    throw new UploadError(`This file uses the coordinate system ${crsName}. Export it as GeoJSON in WGS84 (EPSG:4326) longitude and latitude.`)
  }

  let rawFeatures: { geometry?: any, properties?: any }[]
  switch (json.type) {
    case 'FeatureCollection':
      rawFeatures = Array.isArray(json.features) ? json.features : []
      break
    case 'Feature':
      rawFeatures = [json]
      break
    case 'Polygon':
    case 'MultiPolygon':
    case 'GeometryCollection':
      rawFeatures = [{ geometry: json, properties: {} }]
      break
    default:
      throw new UploadError('This file isn\'t GeoJSON: expected a FeatureCollection, Feature, Polygon or MultiPolygon.')
  }

  const polygons: { geometry: PolygonalGeometry, properties: Record<string, unknown> }[] = []
  let skipped = 0
  for (const f of rawFeatures) {
    const properties = (f?.properties && typeof f.properties === 'object') ? f.properties : {}
    const geometries = f?.geometry?.type === 'GeometryCollection'
      ? (f.geometry.geometries || [])
      : [f?.geometry]
    let found = false
    for (const g of geometries) {
      if ((g?.type === 'Polygon' || g?.type === 'MultiPolygon') && Array.isArray(g.coordinates) && g.coordinates.length > 0) {
        checkCoordinates(g)
        polygons.push({ geometry: { type: g.type, coordinates: g.coordinates }, properties })
        found = true
      }
    }
    if (!found) {
      skipped++
    }
  }
  if (polygons.length === 0) {
    throw new UploadError('This file has no polygons. Upload the boundary of an area, not points or lines.')
  }

  const nameProperty = guessNameProperty(polygons.map(p => p.properties))
  const features = polygons.map((p, index): UploadFeature => {
    const value = nameProperty ? p.properties[nameProperty] : undefined
    const name = (typeof value === 'string' && value.trim()) || (typeof value === 'number' ? String(value) : '') || `Feature ${index + 1}`
    return { index, name, geometry: p.geometry, properties: p.properties }
  })
  return { features, nameProperty, skipped }
}

// Rejects coordinates that can't be longitude and latitude, the usual sign of
// a file in a projected coordinate system without a crs member
function checkCoordinates (g: PolygonalGeometry) {
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const part of parts) {
    for (const ring of part) {
      if (!Array.isArray(ring) || ring.length < 4) {
        throw new UploadError('This file has a polygon ring with fewer than 4 positions.')
      }
      for (const pos of ring) {
        const [lon, lat] = pos as number[]
        if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
          throw new UploadError('This file has a coordinate that isn\'t a pair of numbers.')
        }
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
          throw new UploadError('This file\'s coordinates aren\'t longitude and latitude. Export it as GeoJSON in WGS84 (EPSG:4326).')
        }
      }
    }
  }
}

// The property that best names the features: string values, mostly distinct,
// preferring keys that say "name"
function guessNameProperty (props: Record<string, unknown>[]): string | undefined {
  const keys = new Set(props.flatMap(p => Object.keys(p)))
  let best: { key: string, score: number } | undefined
  for (const key of keys) {
    const values = props.map(p => p[key]).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    if (values.length < props.length) {
      continue
    }
    const distinct = new Set(values).size / values.length
    let score = distinct
    if (/name/i.test(key)) {
      score += 2
    }
    if (/^name$/i.test(key)) {
      score += 1
    }
    // Ids and codes are distinct but say little
    if (/(^|_)(id|guid|globalid|fid|objectid|code|abbr)/i.test(key)) {
      score -= 1
    }
    if (!best || score > best.score) {
      best = { key, score }
    }
  }
  return best && best.score >= 1 ? best.key : undefined
}

export function countVertices (g: PolygonalGeometry | QueryPolygon): number {
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let n = 0
  for (const part of parts) {
    for (const ring of part) {
      n += ring.length
    }
  }
  return n
}

// The polygons of each feature, as one MultiPolygon
export function featuresToPolygon (features: { geometry: PolygonalGeometry }[]): QueryPolygon {
  const coordinates: GeoJSON.Position[][][] = []
  for (const f of features) {
    if (f.geometry.type === 'Polygon') {
      coordinates.push(f.geometry.coordinates)
    } else {
      coordinates.push(...f.geometry.coordinates)
    }
  }
  return { type: 'MultiPolygon', coordinates }
}

// Trims and simplifies the chosen features, as the options say, and checks
// that they make a usable query area
export function processUpload (features: UploadFeature[], options: UploadProcessOptions): ProcessedUpload {
  const errors: string[] = []
  const trimmed = features.map((f): UploadFeature => {
    let geometry: PolygonalGeometry = f.geometry
    if (options.trimPrecision) {
      geometry = roundGeometry(geometry, UPLOAD_COORDINATE_PRECISION)
    }
    return { ...f, geometry }
  })
  const processed = options.simplify ? simplifyTogether(trimmed, UPLOAD_SIMPLIFY_MIN_WEIGHT) : trimmed

  for (const f of processed) {
    if (kinks(f.geometry).features.length > 0) {
      errors.push(options.simplify
        ? `"${f.name}" has an outline that crosses itself. Try turning off simplifying, or fix the file.`
        : `"${f.name}" has an outline that crosses itself. Fix the file and upload it again.`)
    }
  }

  // Parts are measured one at a time and summed, so overlapping features
  // would count the overlap twice. Checked on coarse outlines whatever the
  // options, since intersecting detailed ones can take seconds.
  const outlines = simplifyTogether(processed, OVERLAP_CHECK_MIN_WEIGHT)
  for (let i = 0; i < outlines.length; i++) {
    for (let j = i + 1; j < outlines.length; j++) {
      const a = outlines[i]!
      const b = outlines[j]!
      if (bboxesOverlap(a.geometry, b.geometry) && featuresOverlap(a.geometry, b.geometry)) {
        errors.push(`"${a.name}" and "${b.name}" overlap. Choose features that don't overlap.`)
      }
    }
  }

  const polygon = featuresToPolygon(processed)
  return {
    polygon,
    features: processed,
    vertexCount: countVertices(polygon),
    originalVertexCount: features.reduce((n, f) => n + countVertices(f.geometry), 0),
    errors,
  }
}

function bboxesOverlap (a: PolygonalGeometry, b: PolygonalGeometry): boolean {
  const ba = polygonBbox(featuresToPolygon([{ geometry: a }]))
  const bb = polygonBbox(featuresToPolygon([{ geometry: b }]))
  if (!ba || !bb) {
    return false
  }
  return ba.sw.lon < bb.ne.lon && bb.sw.lon < ba.ne.lon && ba.sw.lat < bb.ne.lat && bb.sw.lat < ba.ne.lat
}

// Rounds each position to a number of decimal places, dropping any third
// coordinate. Rounding can land neighboring positions on the same point, which
// would read as the outline crossing itself, so repeats are dropped too. A ring
// left with fewer than 4 positions is too small to keep; if every ring of the
// geometry is, it's kept unrounded.
export function roundGeometry (g: PolygonalGeometry, precision: number): PolygonalGeometry {
  const factor = 10 ** precision
  const roundRing = (ring: GeoJSON.Position[]): GeoJSON.Position[] => {
    const out: GeoJSON.Position[] = []
    for (const pos of ring) {
      const p = [Math.round(pos[0]! * factor) / factor, Math.round(pos[1]! * factor) / factor]
      const prev = out[out.length - 1]
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) {
        out.push(p)
      }
    }
    return out
  }
  const roundPolygon = (rings: GeoJSON.Position[][]): GeoJSON.Position[][] | null => {
    const [outer, ...holes] = rings.map(roundRing)
    if (!outer || outer.length < 4) {
      return null
    }
    return [outer, ...holes.filter(h => h.length >= 4)]
  }
  const parts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
    .map(roundPolygon)
    .filter((p): p is GeoJSON.Position[][] => p !== null)
  if (parts.length === 0) {
    return g
  }
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: parts[0]! } : { type: 'MultiPolygon', coordinates: parts }
}

// Simplifies features as one topology (TopoJSON), so a border two features
// share is simplified once and stays shared, with no gaps or slivers opening
// between neighbors. minWeight is the Visvalingam effective area, in square
// degrees, below which a position is dropped. Arcs keep their ends, so a ring
// never collapses.
function simplifyTogether (features: UploadFeature[], minWeight: number): UploadFeature[] {
  const objects = {
    area: {
      type: 'FeatureCollection' as const,
      features: features.map(f => ({ type: 'Feature' as const, properties: {}, geometry: f.geometry })),
    },
  }
  // topojson-simplify types its input with properties of {}, not null
  const topo = simplify(presimplify(topology(objects) as Parameters<typeof presimplify>[0]), minWeight)
  const simplified = topoFeature(topo, topo.objects.area!) as GeoJSON.FeatureCollection<PolygonalGeometry | null>
  return features.map((f, i) => ({ ...f, geometry: simplified.features[i]?.geometry ?? f.geometry }))
}

// The simplifying weight for the outlines the overlap check compares, about
// ten times coarser than UPLOAD_SIMPLIFY_MIN_WEIGHT
const OVERLAP_CHECK_MIN_WEIGHT = 1e-6
// Of the smaller feature's area, how much two features may share before they
// count as overlapping. Neighbors whose files don't quite agree on a border
// cross a little along it; a feature that really overlaps another shares far
// more.
const OVERLAP_TOLERANCE = 0.01

// Whether two features share more than a sliver of area. This covers one
// inside the other, too.
function featuresOverlap (a: PolygonalGeometry, b: PolygonalGeometry): boolean {
  const shared = intersect({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: a },
      { type: 'Feature', properties: {}, geometry: b },
    ],
  })
  if (!shared) {
    return false
  }
  return area(shared) > OVERLAP_TOLERANCE * Math.min(area(a), area(b))
}

// A name for an upload: its one feature's name, or the file's name
export function suggestUploadName (filename: string, features: UploadFeature[]): string {
  if (features.length === 1 && !/^Feature \d+$/.test(features[0]!.name)) {
    return features[0]!.name
  }
  return filename.replace(/\.(geo)?json$/i, '')
}

// The features as a GeoJSON FeatureCollection, as saved and downloaded
export function uploadFeatureCollection (features: UploadFeature[]): GeoJSON.FeatureCollection<PolygonalGeometry> {
  return {
    type: 'FeatureCollection',
    features: features.map(f => ({
      type: 'Feature',
      properties: { ...f.properties, name: f.name },
      geometry: f.geometry,
    })),
  }
}
