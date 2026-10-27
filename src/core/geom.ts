import type { Marker } from 'maplibre-gl'

export interface Geometry {
  type: string
  coordinates: any[]
}

export interface Feature {
  type: string
  id: string
  properties: Record<string, any>
  geometry: Geometry
}

export interface Point {
  lon: number
  lat: number
}

export interface Bbox {
  sw: Point
  ne: Point
  valid: boolean
}

export function ptString (p: Point): string {
  return `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`
}

export function parseBbox (bbox?: string): Bbox {
  const p = (bbox || '').split(',').map(Number.parseFloat).filter(s => (!Number.isNaN(s)))
  const sw = { lon: 0, lat: 0 }
  const ne = { lon: 0, lat: 0 }
  if (p.length === 4) {
    sw.lon = p[0]!
    sw.lat = p[1]!
    ne.lon = p[2]!
    ne.lat = p[3]!
    return { sw, ne, valid: true }
  }
  return { sw: sw, ne: ne, valid: false, }
}

export function bboxString (bbox: Bbox): string {
  return [
    bbox.sw.lon,
    bbox.sw.lat,
    bbox.ne.lon,
    bbox.ne.lat
  ].map(s => (s.toFixed(5))).join(',')
}

// One member stop of a clicked cluster, connecting agency → route(s) → stop.
export interface ClusterMemberInfo {
  stop_id?: string
  stop_name?: string
  agency_names: string[]
  route_names: string[]
}

export interface PopupFeature {
  point: Point
  featureId?: string | number // Feature ID for highlighting
  sourceLayer?: string // Source layer name for highlighting (e.g., 'flexPolygons', 'lines', 'points')
  // Structured data for Vue component rendering (preferred - avoids XSS concerns)
  featureType?: 'stop' | 'route' | 'flex' | 'cluster'
  data?: {
    // Stop fields
    stop_id?: string
    stop_name?: string
    routes?: string[]
    agencies?: string[]
    // Route fields
    route_id?: string
    route_short_name?: string
    route_long_name?: string
    route_type_name?: string
    agency_name?: string
    average_frequency?: number
    frequency_irregular?: boolean
    frequency_directions_differ?: boolean
    // Flex fields
    location_id?: string
    location_name?: string
    route_names?: string
    area_type?: string
    advance_notice?: string
    rider_eligibility?: string
    phone_number?: string
    marked?: boolean
    // Stop cluster fields
    cluster_id?: string
    // The cluster's name, with the place it is near.
    cluster_name?: string
    agency_names?: string[]
    cluster_members?: ClusterMemberInfo[]
  }
  // Legacy HTML text (deprecated - use structured data instead)
  text?: string
}

/**
 * Event fired by MapLibre Marker on 'drag' and 'dragend'.
 * The `target` is the Marker instance that emitted the event.
 */
export interface MarkerDragEvent {
  type: string
  target: Marker
}

export interface MarkerFeature {
  onDrag?: (e: MarkerDragEvent) => void
  onDragEnd?: (e: MarkerDragEvent) => void
  onCreated?: (marker: Marker) => void
  point: Point
  color: string
  draggable: boolean
  element?: HTMLElement // Optional HTML element for custom marker
}

export function convertBbox (bbox?: Bbox): { min_lon?: number, min_lat?: number, max_lon?: number, max_lat?: number } | undefined {
  if (!bbox) { return undefined }
  return {
    min_lon: bbox ? bbox.sw.lon : undefined,
    min_lat: bbox ? bbox.sw.lat : undefined,
    max_lon: bbox ? bbox.ne.lon : undefined,
    max_lat: bbox ? bbox.ne.lat : undefined
  }
}

// A query area from an uploaded or saved geography, in WGS84. Sent with each
// request, since the Transitland server doesn't store it.
export type QueryPolygon = GeoJSON.MultiPolygon

// The ways a config can name its query area. The first of polygon,
// geographyIds and bbox that is set is the one used (queryAreaVariables).
export interface QueryArea {
  bbox?: Bbox
  geographyIds?: number[]
  polygon?: QueryPolygon
}

// The parts of a query polygon, for filters that take one Polygon at a time
// (census geographies' `within`).
export function polygonParts (polygon?: QueryPolygon): GeoJSON.Polygon[] {
  return (polygon?.coordinates || []).map(coordinates => ({ type: 'Polygon', coordinates }))
}

// Whether a config carries a search area: a bbox, at least one geography id,
// or a polygon. The one validation every run entry point shares, client and
// server.
export function hasSearchArea (config: QueryArea): boolean {
  return !!config.bbox || (config.geographyIds?.length ?? 0) > 0 || polygonParts(config.polygon).length > 0
}

// The query area for a location filter: the polygon's parts when there is
// one, then the geography ids when there are any, otherwise the bbox. The
// server lets a bbox outrank the others and ignores an empty id list, so at
// most one is set.
export function queryAreaVariables (config: QueryArea): {
  bbox?: ReturnType<typeof convertBbox>
  geographyIds?: number[]
  polygons?: GeoJSON.Polygon[]
} {
  const polygons = polygonParts(config.polygon)
  if (polygons.length > 0) {
    return { bbox: undefined, geographyIds: undefined, polygons }
  }
  if (config.geographyIds && config.geographyIds.length > 0) {
    return { bbox: undefined, geographyIds: config.geographyIds, polygons: undefined }
  }
  return { bbox: convertBbox(config.bbox), geographyIds: undefined, polygons: undefined }
}

// The `location` filter for a stops query. A polygon goes as one feature, which
// the server matches stops against whole, so a MultiPolygon needs one request.
export function stopLocationFilter (config: QueryArea) {
  const area = queryAreaVariables(config)
  return {
    bbox: area.bbox,
    geography_ids: area.geographyIds,
    features: config.polygon && area.polygons
      ? [{ type: 'Feature', id: 'query-area', properties: {}, geometry: config.polygon }]
      : undefined,
  }
}

// The bbox around a query polygon (min/max of its coordinates), for queries
// that take only a bbox, such as the feeds search.
export function polygonBbox (polygon?: QueryPolygon): Bbox | undefined {
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  for (const part of polygon?.coordinates || []) {
    for (const ring of part) {
      for (const [lon, lat] of ring) {
        if (lon === undefined || lat === undefined) {
          continue
        }
        minLon = Math.min(minLon, lon)
        minLat = Math.min(minLat, lat)
        maxLon = Math.max(maxLon, lon)
        maxLat = Math.max(maxLat, lat)
      }
    }
  }
  if (!Number.isFinite(minLon)) {
    return undefined
  }
  return { sw: { lon: minLon, lat: minLat }, ne: { lon: maxLon, lat: maxLat }, valid: true }
}

// Collects polygonal outlines into one MultiPolygon by listing their polygons
// together. No union: the outlines are clipped to non-overlapping parts of a
// query polygon, so they don't overlap either. A geometry that isn't a
// Polygon or MultiPolygon is kept as it is.
export function collectPolygons (a?: Geometry, b?: Geometry): Geometry | undefined {
  if (!a || !b) {
    return a ?? b
  }
  const polygonsOf = (g: Geometry): any[] | undefined => {
    if (g.type === 'Polygon') {
      return [g.coordinates]
    }
    if (g.type === 'MultiPolygon') {
      return g.coordinates
    }
    return undefined
  }
  const pa = polygonsOf(a)
  const pb = polygonsOf(b)
  if (!pa || !pb) {
    return a
  }
  return { type: 'MultiPolygon', coordinates: [...pa, ...pb] }
}
