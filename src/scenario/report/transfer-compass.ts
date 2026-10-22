/**
 * The places trips at the stops come from and go to, laid out around the
 * stops as on a compass: each place by its bearing and distance from them.
 *
 * Bearings and distances are flat-earth arithmetic on coordinates, close
 * enough over a region to place a mark on a diagram; they are never
 * reported as figures.
 */

import type { TripTableRoute } from './subject-trips'
import { TRANSFER_GRADES, routeLabel, type TransferArrivalSummary, type TransferGrade, type TransferRouteChoice, type TransferTripDestination } from './transfers'

const KM_PER_DEGREE = 111.32

// A place trips come from (arriving) or go to (departing), and the
// destinations (transferTripKey) whose trips start or end there.
export interface TransferCompassPlace {
  name: string
  // Degrees clockwise from north, and kilometers, from the stops.
  bearing: number
  km: number
  keys: string[]
  // Trips.
  count: number
}

// Connections by grade.
export type TransferGradeCounts = Record<TransferGrade, number>

// The bearing (degrees clockwise from north) and distance (km) from one
// [lon, lat] to another.
export function bearingAndDistance (from: [number, number], to: [number, number]): { bearing: number, km: number } {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180)
  const dy = to[1] - from[1]
  const bearing = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  return { bearing, km: Math.hypot(dx, dy) * KM_PER_DEGREE }
}

// A distance as a share of a compass's radius, 0 at the stops and 1 at the
// farthest place, on a log scale: places nearby spread out, and one far
// away, a long-distance train's end, still fits.
export function compassScale (km: number, maxKm: number): number {
  return maxKm > 0 ? Math.log1p(Math.min(km, maxKm)) / Math.log1p(maxKm) : 0
}

// Rings for a compass at round distances inside its farthest place, at most
// four.
export function compassRings (maxKm: number): number[] {
  return [1, 3, 10, 30, 100, 300, 1000, 3000].filter(km => km <= maxKm).slice(-4)
}

// The middle of the widest gap between bearings (degrees), where a
// compass's ring labels keep out of its places' way.
export function quietBearing (bearings: number[]): number {
  const sorted = bearings.map(b => ((b % 360) + 360) % 360).sort((a, b) => a - b)
  let widest = 0
  let at = 45
  sorted.forEach((b, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 360
    if (next - b > widest) {
      widest = next - b
      at = (b + widest / 2) % 360
    }
  })
  return at
}

// The middle of some [lon, lat] points; none for no points.
export function centerOf (points: [number, number][]): [number, number] | undefined {
  if (points.length === 0) {
    return undefined
  }
  const sum = points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

/**
 * The places arriving trips ('from') start at, or departing trips ('to') end
 * at, from the trip choices, each with the destinations whose trips most
 * often start or end there. Places are by station name; those with no known
 * location are left out.
 */
export function transferCompassPlaces (choices: TransferRouteChoice[], side: 'from' | 'to', center: [number, number]): TransferCompassPlace[] {
  const places = new Map<string, TransferCompassPlace>()
  for (const d of choices.flatMap(r => r.directions.flatMap(x => x.destinations))) {
    const name = side === 'from' ? d.run.origin : d.run.terminus
    const point = side === 'from' ? d.run.originPoint : d.run.terminusPoint
    if (!name || !point) {
      continue
    }
    const place = places.get(name) ?? { name, ...bearingAndDistance(center, point), keys: [], count: 0 }
    place.keys.push(d.key)
    place.count += d.count
    places.set(name, place)
  }
  return [...places.values()].sort((a, b) => a.bearing - b.bearing)
}

// A flow on the rose: the connections from arrivals on one destination to
// departures on another, with the places their trips come from and go to.
export interface TransferRoseFlow {
  from: string
  to: string
  fromKey: string
  toKey: string
  grades: TransferGradeCounts
  total: number
}

// A destination as the rose's table names it: its route and its name.
export interface TransferRoseTrip {
  route: string
  agency: string
  label: string
}

export interface TransferRose {
  // Every place a flow comes from or goes to, by bearing.
  places: { name: string, bearing: number, km: number }[]
  // By most connections.
  flows: TransferRoseFlow[]
  // The destinations by key, arriving and departing.
  from: Map<string, TransferRoseTrip>
  to: Map<string, TransferRoseTrip>
}

interface RoseTripInfo {
  routes: Map<number, TripTableRoute>
  from: Map<string, TransferTripDestination & { routeId: number }>
  to: Map<string, TransferTripDestination & { routeId: number }>
}

/**
 * Connections as flows from where arriving trips come from to where
 * departing trips go, for one compass rose: each pair of arriving and
 * departing destinations, placed by the compass places their trips start
 * and end at. Pairs with an unplaced end are left out.
 */
export function transferRose (summaries: TransferArrivalSummary[], compass: { from: TransferCompassPlace[], to: TransferCompassPlace[] }, info: RoseTripInfo): TransferRose {
  const placeOf = (places: TransferCompassPlace[]) => new Map(places.flatMap(p => p.keys.map(k => [k, p] as const)))
  const fromPlace = placeOf(compass.from)
  const toPlace = placeOf(compass.to)
  const flows: TransferRoseFlow[] = []
  for (const { from, pairs } of summaries) {
    const origin = fromPlace.get(from.key)
    for (const p of pairs) {
      const destination = toPlace.get(p.to.key)
      const grades = { missed: p.missed, close: p.close, acceptable: p.acceptable, unacceptable: p.unacceptable }
      const total = TRANSFER_GRADES.reduce((n, g) => n + grades[g], 0)
      if (origin && destination && total > 0) {
        flows.push({ from: origin.name, to: destination.name, fromKey: from.key, toKey: p.to.key, grades, total })
      }
    }
  }
  const places = new Map<string, { name: string, bearing: number, km: number }>()
  for (const p of [...compass.from, ...compass.to]) {
    if (!places.has(p.name) && flows.some(f => f.from === p.name || f.to === p.name)) {
      places.set(p.name, { name: p.name, bearing: p.bearing, km: p.km })
    }
  }
  const trips = (byKey: RoseTripInfo['from'], keys: Set<string>) => new Map([...keys].map((key) => {
    const d = byKey.get(key)
    const route = d ? info.routes.get(d.routeId) : undefined
    return [key, { route: routeLabel(route), agency: route?.agency_name ?? '', label: d?.label ?? '' }] as const
  }))
  return {
    places: [...places.values()].sort((a, b) => a.bearing - b.bearing),
    flows: flows.sort((a, b) => b.total - a.total),
    from: trips(info.from, new Set(flows.map(f => f.fromKey))),
    to: trips(info.to, new Set(flows.map(f => f.toKey))),
  }
}
