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
  const p = (bbox || '').split(',').map(parseFloat).filter(s => (!isNaN(s)))
  const sw = { lon: 0, lat: 0 }
  const ne = { lon: 0, lat: 0 }
  if (p.length === 4) {
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
