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
  if (p.length === 4 && p[0] !== undefined && p[1] !== undefined && p[2] !== undefined && p[3] !== undefined) {
    sw.lon = p[0]
    sw.lat = p[1]
    ne.lon = p[2]
    ne.lat = p[3]
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
  text: string
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
