// Isochrones (#486): the area a rider can reach from a point, or that can
// reach a point, within a set of travel times, from tlrouter's GET /isochrone
// (reached through the default Transitland backend at /routing/isochrone).
//
// Pure helpers: building the request, reading the response, and styling the
// bands. The fetch itself lives in app/composables/useIsochrone.ts.

import { RouteType, type Feature, type Point } from '../core'

// Cutoffs offered in the panel, in minutes; the router takes at most 8.
export const ISOCHRONE_CUTOFF_CHOICES = [10, 15, 20, 30, 45, 60]
export const ISOCHRONE_DEFAULT_CUTOFFS = [15, 30, 45]
export const ISOCHRONE_MAX_CUTOFFS = 8

// Meters from the origin to the first stop (or the last stop to the
// destination). The router's own default.
export const ISOCHRONE_DEFAULT_MAX_WALK = 800
export const ISOCHRONE_MAX_WALK_CHOICES = [400, 800, 1200, 1600, 2400]

export const ISOCHRONE_DEFAULT_TIME = '08:00'

// The router's transit subtypes for the GTFS route types the scenario
// filters by. See ROUTETYPES in transitland-router's raptor/query.go.
const ROUTER_SUBTYPES = new Map<RouteType, string>([
  [RouteType.LightRail, 'tram'],
  [RouteType.Subway, 'subway'],
  [RouteType.IntercityRail, 'rail'],
  [RouteType.Bus, 'bus'],
  [RouteType.Ferry, 'ferry'],
])

export const ISOCHRONE_ROUTE_TYPES = [...ROUTER_SUBTYPES.keys()]

// What a rider may use: walking alone, or transit (with walking to, from and
// between stops) limited to some route types, or of every type.
export type IsochroneMode
  = | { walkOnly: true }
    | { walkOnly: false, routeTypes?: RouteType[] }

export interface IsochroneParams {
  place: Point
  // The area that can reach `place` by `time`, rather than the area reachable
  // from it.
  arriveBy: boolean
  date: string // yyyy-MM-dd
  time: string // HH:mm, wall clock at `place`
  cutoffs: number[] // minutes
  mode: IsochroneMode
  maxWalk: number // meters
}

// Contouring knobs, left at the router's defaults unless set from the debug
// menu. Blank (undefined) leaves the router default.
export interface IsochroneRenderOptions {
  expansion?: 'network' | 'disk'
  buffer?: number
  cellSize?: number
  generalize?: number
  denoise?: number
  smooth?: number
}

// The router's `mode` for a rider's options. Every route type the scenario
// filters by, or none named, is all of transit.
export function isochroneModeParam (mode: IsochroneMode): string {
  if (mode.walkOnly) {
    return 'WALK'
  }
  const types = mode.routeTypes
  if (!types || ISOCHRONE_ROUTE_TYPES.every(t => types.includes(t))) {
    return 'TRANSIT'
  }
  const subtypes = ISOCHRONE_ROUTE_TYPES.filter(t => types.includes(t)).map(t => ROUTER_SUBTYPES.get(t)!)
  // No route type left is no transit to ride.
  if (subtypes.length === 0) {
    return 'WALK'
  }
  return ['TRANSIT', ...subtypes].join(',')
}

// The rider's options as the scenario's route type filter sets them: unset
// is every type, and an empty selection leaves only walking.
export function isochroneModeFromRouteTypes (routeTypes: RouteType[] | undefined): IsochroneMode {
  if (routeTypes === undefined) {
    return { walkOnly: false }
  }
  if (routeTypes.length === 0) {
    return { walkOnly: true }
  }
  return { walkOnly: false, routeTypes: ISOCHRONE_ROUTE_TYPES.filter(t => routeTypes.includes(t)) }
}

// The query string for GET /isochrone.
export function isochroneQuery (p: IsochroneParams, render: IsochroneRenderOptions = {}): URLSearchParams {
  const q = new URLSearchParams()
  // The router searches backwards from toPlace for arrive-by, so the one
  // point goes in whichever place the direction names.
  q.set(p.arriveBy ? 'toPlace' : 'fromPlace', `${p.place.lat.toFixed(6)},${p.place.lon.toFixed(6)}`)
  if (p.arriveBy) {
    q.set('arriveBy', 'true')
  }
  q.set('date', p.date)
  q.set('time', p.time.length === 5 ? `${p.time}:00` : p.time)
  for (const m of [...p.cutoffs].sort((a, b) => a - b)) {
    q.append('cutoff', `${m}m`)
  }
  q.set('mode', isochroneModeParam(p.mode))
  q.set('maxWalkingDistance', String(p.maxWalk))
  // The schedule alone: realtime would make "today" differ from every other
  // date, and the NAT plans from schedules.
  q.set('ignoreRealtimeUpdates', 'true')
  // The date asked for, as the scenario counts service: a date outside a
  // feed's service period has none, rather than a stand-in week's.
  q.set('useFallbackDates', 'false')
  // walkingSpeed is not sent: the walk providers ignore it (router #189).
  for (const [k, v] of Object.entries(render)) {
    if (v !== undefined && v !== '') {
      q.set(k, String(v))
    }
  }
  return q
}

// One band: the area within `minutes` of the place.
export interface IsochroneBand {
  minutes: number
  seconds: number
  color: string
  feature: Feature
}

export type IsochroneResult
  = | { bands: IsochroneBand[], error?: undefined }
    | { bands?: undefined, error: string }

// Sequential single hue, darkest for the shortest time, so nearer reads as
// more intense while the outer band stays visible on a light basemap.
// ColorBrewer Blues with its light end trimmed, as the router's playground.
const BAND_RAMP = ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6']

// The color of band `rank` of `total`, rank 0 being the shortest time.
export function isochroneBandColor (rank: number, total: number): string {
  if (total <= 1) {
    return BAND_RAMP[0]!
  }
  return BAND_RAMP[Math.round((rank / (total - 1)) * (BAND_RAMP.length - 1))]!
}

function isPolygonal (f: any): boolean {
  return f?.geometry?.type === 'MultiPolygon' || f?.geometry?.type === 'Polygon'
}

function bandSeconds (f: any): number {
  const t = f?.properties?.time
  if (typeof t === 'number') {
    return t
  }
  const c = f?.properties?.contour
  return typeof c === 'number' ? c * 60 : 0
}

// Read a response: its bands shortest first, colored, or the router's error.
// A body that isn't JSON (a proxy's HTML error page) is reported by status.
export function parseIsochroneResponse (status: number, body: string): IsochroneResult {
  let json: any
  try {
    json = JSON.parse(body)
  } catch {
    return { error: `Travel time request failed (HTTP ${status})` }
  }
  if (json && typeof json.error === 'string') {
    return { error: json.error }
  }
  if (status < 200 || status >= 300) {
    return { error: `Travel time request failed (HTTP ${status})` }
  }
  if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
    return { error: 'Travel time response was not a FeatureCollection' }
  }
  const polys = (json.features as any[]).filter(isPolygonal).sort((a, b) => bandSeconds(a) - bandSeconds(b))
  const bands = polys.map((f, rank): IsochroneBand => {
    const seconds = bandSeconds(f)
    const color = isochroneBandColor(rank, polys.length)
    return {
      seconds,
      minutes: Math.round(seconds / 60),
      color,
      feature: {
        type: 'Feature',
        id: `isochrone-${seconds}`,
        geometry: f.geometry,
        properties: { ...f.properties, fill: color },
      },
    }
  })
  return { bands }
}

// Nothing reachable: no band has any area.
export function isochroneIsEmpty (bands: IsochroneBand[]): boolean {
  return bands.every(b => (b.feature.geometry.coordinates?.length ?? 0) === 0)
}

// Features for the map: longest first, so the shorter, darker bands they
// contain draw over them.
export function isochroneMapFeatures (bands: IsochroneBand[]): Feature[] {
  return [...bands].reverse().map(b => b.feature)
}

// Legend rows, shortest time first.
export function isochroneLegend (bands: IsochroneBand[]): { color: string, label: string }[] {
  return bands.map(b => ({ color: b.color, label: `Within ${b.minutes} min` }))
}

// "lat,lon" as the URL holds a place.
export function formatIsochronePlace (p: Point): string {
  return `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`
}

export function parseIsochronePlace (s: string | undefined): Point | undefined {
  if (!s) {
    return undefined
  }
  const [lat, lon] = s.split(',').map(Number)
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return undefined
  }
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return undefined
  }
  return { lat, lon }
}
