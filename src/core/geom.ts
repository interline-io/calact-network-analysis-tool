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

export function parseBbox (bbox: string | null): Bbox {
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

export interface PopupFeature {
  point: Point
  featureId?: string | number // Feature ID for highlighting
  sourceLayer?: string // Source layer name for highlighting (e.g., 'flexPolygons', 'lines', 'points')
  // Structured data for Vue component rendering (preferred - avoids XSS concerns)
  featureType?: 'stop' | 'route' | 'flex'
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
    // Flex fields
    location_id?: string
    location_name?: string
    route_names?: string
    area_type?: string
    advance_notice?: string
    phone_number?: string
    marked?: boolean
  }
  // Legacy HTML text (deprecated - use structured data instead)
  text?: string
}

export interface MarkerFeature {
  onDragEnd: any
  point: Point
  color: string
  draggable: boolean
  element?: HTMLElement // Optional HTML element for custom marker
}

export function convertBbox (bbox: Bbox | undefined): { min_lon: number | null, min_lat: number | null, max_lon: number | null, max_lat: number | null } | null {
  if (!bbox) { return null }
  return {
    min_lon: bbox ? bbox.sw.lon : null,
    min_lat: bbox ? bbox.sw.lat : null,
    max_lon: bbox ? bbox.ne.lon : null,
    max_lat: bbox ? bbox.ne.lat : null
  }
}
