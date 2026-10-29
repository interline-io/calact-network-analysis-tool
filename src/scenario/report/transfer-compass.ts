// Trip origins and destinations around the stops, placed as on a compass by
// bearing and distance.

import { KM_PER_DEGREE } from '../../core'
import type { TripTableRoute } from './subject-trips'
import { choiceDestinations, routeLabel, type TransferArrivalSummary, type TransferGrade, type TransferRouteChoice, type TransferTripDestination } from './transfers'

// Ends of one name within this many km of a place's point are that place.
const SAME_PLACE_KM = 1

// Where arriving trips start or departing trips end, with the destinations
// (transferTripKey) whose trips start or end there.
export interface TransferCompassPlace {
  // The station's name and location, as two stations may share a name.
  key: string
  name: string
  // Degrees clockwise from north, and kilometers, from the stops.
  bearing: number
  km: number
  keys: string[]
  // How many trips those destinations have.
  count: number
}

// Connections by grade.
export type TransferGradeCounts = Record<TransferGrade, number>

// The bearing (degrees clockwise from north) and distance (km) from one
// [lon, lat] to another: flat-earth arithmetic, close enough over a region
// to place a mark on a diagram.
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

// The middle of the widest gap between bearings (degrees); 45 for none.
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

// A unit vector along a bearing (degrees), in a drawing's frame, y down.
export function along (bearing: number): [number, number] {
  const a = (bearing * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

// Bearings (degrees) fanned apart so no two are closer than `gap`, across
// north too.
export function spreadBearings (bearings: number[], gap: number): number[] {
  // Cut the circle at the middle of its widest gap, so neighbors either side
  // of north sort side by side.
  const cut = quietBearing(bearings)
  const unrolled = bearings.map(b => (((b - cut) % 360) + 360) % 360)
  const order = unrolled.map((_, i) => i).sort((a, b) => unrolled[a]! - unrolled[b]!)
  const angles = [...unrolled]
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    for (let k = 0; k < order.length - 1; k++) {
      const [i, j] = [order[k]!, order[k + 1]!]
      const short = gap - (angles[j]! - angles[i]!)
      if (short > 0.01) {
        angles[i] = angles[i]! - short / 2
        angles[j] = angles[j]! + short / 2
        moved = true
      }
    }
    if (!moved) {
      break
    }
  }
  return angles.map(a => a + cut)
}

// The heights of labels down a column beside a drawing, each as near its
// mark's height as the others allow; where more marks than fit, the lightest
// go unlabeled (undefined).
//
// Labels stay at least `gap` apart between `top` and `bottom`, and out of
// `skip`, a band kept for something else, such as a compass point.
export function columnLabels (marks: { y: number, weight: number }[], top: number, bottom: number, gap: number, skip?: [number, number]): (number | undefined)[] {
  // Labels are spread with the skipped band taken out of the column, then
  // put back; a label at the band's edge goes to its mark's side.
  const [from, to] = skip ?? [bottom, bottom]
  const cut = to - from
  const squeeze = (y: number) => (y <= from ? y : Math.max(from, y - cut))
  const unsqueeze = (c: number, y: number) => (c < from || (c === from && y < from + cut / 2) ? c : c + cut)
  const room = Math.max(0, Math.floor((bottom - cut - top) / gap) + 1)
  const kept = marks.map((_, i) => i)
    .sort((a, b) => marks[b]!.weight - marks[a]!.weight)
    .slice(0, room)
    .sort((a, b) => marks[a]!.y - marks[b]!.y)
  const ys: (number | undefined)[] = marks.map(() => undefined)
  // Down the column, then back up, so each label moves only as far as it
  // must. Labels that fit stay between top and bottom through both passes.
  let last = Number.NEGATIVE_INFINITY
  for (const i of kept) {
    last = Math.max(squeeze(marks[i]!.y), last + gap, top)
    ys[i] = last
  }
  let next = Number.POSITIVE_INFINITY
  for (const i of [...kept].reverse()) {
    next = Math.min(ys[i]!, next - gap, bottom - cut)
    ys[i] = next
  }
  return ys.map((c, i) => (c === undefined ? undefined : unsqueeze(c, marks[i]!.y)))
}

// The middle of some [lon, lat] points; none for no points.
export function centerOf (points: [number, number][]): [number, number] | undefined {
  if (points.length === 0) {
    return undefined
  }
  const sum = points.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0])
  return [sum[0] / points.length, sum[1] / points.length]
}

// Where arriving trips start ('from') and departing trips end ('to'), each
// place with the destinations whose trips most often start or end there.
//
// A place is a station by name and point. An end within a kilometer of a
// place of its name joins that place, so a station's platforms and bays are
// one place, while stations of one name elsewhere stay apart. Both sides
// share their places, so a station has one key. Ends with no point are left
// out.
export function transferCompassPlaces (choices: { from: TransferRouteChoice[], to: TransferRouteChoice[] }, center: [number, number]): { from: TransferCompassPlace[], to: TransferCompassPlace[] } {
  // The stations found so far, by name, each at its first end's point.
  const stations = new Map<string, { key: string, point: [number, number] }[]>()
  const stationAt = (name: string, point: [number, number]) => {
    const named = stations.get(name) ?? []
    const near = named.find(s => bearingAndDistance(s.point, point).km < SAME_PLACE_KM)
    if (near) {
      return near
    }
    const station = { key: `${name}|${point.join(',')}`, point }
    stations.set(name, [...named, station])
    return station
  }
  const side = (routes: TransferRouteChoice[], end: 'from' | 'to') => {
    const places = new Map<string, TransferCompassPlace>()
    for (const d of choiceDestinations(routes)) {
      const name = end === 'from' ? d.run.origin : d.run.terminus
      const point = end === 'from' ? d.run.originPoint : d.run.terminusPoint
      if (!name || !point) {
        continue
      }
      const { key, point: at } = stationAt(name, point)
      const place = places.get(key) ?? { key, name, ...bearingAndDistance(center, at), keys: [], count: 0 }
      place.keys.push(d.key)
      place.count += d.count
      places.set(key, place)
    }
    return [...places.values()].sort((a, b) => a.bearing - b.bearing)
  }
  return { from: side(choices.from, 'from'), to: side(choices.to, 'to') }
}

// A flow on the rose: the connections from arrivals on one destination to
// departures on another, with the keys of the places where their trips start
// and end.
export interface TransferRoseFlow {
  from: string
  to: string
  fromKey: string
  toKey: string
  grades: TransferGradeCounts
  total: number
}

// A destination's route, agency and name, for the rose's table.
export interface TransferRoseTrip {
  route: string
  agency: string
  label: string
}

// A place on the rose, with the connections of every flow that starts or
// ends there, and the destinations whose trips start there (arriving) or end
// there (departing).
export type TransferRosePlace = Pick<TransferCompassPlace, 'key' | 'name' | 'bearing' | 'km'> & { total: number, fromKeys: string[], toKeys: string[] }

// The Compass view's places and the flows between them.
export interface TransferRose {
  // Every place where a flow starts or ends, by bearing.
  places: TransferRosePlace[]
  // By most connections.
  flows: TransferRoseFlow[]
  // The destinations by key, arriving and departing.
  from: Map<string, TransferRoseTrip>
  to: Map<string, TransferRoseTrip>
}

interface RoseTripInfo {
  routes: Map<number, TripTableRoute>
  from: Map<string, TransferTripDestination>
  to: Map<string, TransferTripDestination>
}

// Connections as flows from arriving trips' origins to departing trips'
// destinations, one per pair of destinations; pairs with an unplaced end are
// left out.
export function transferRose (summaries: TransferArrivalSummary[], compass: { from: TransferCompassPlace[], to: TransferCompassPlace[] }, info: RoseTripInfo): TransferRose {
  const placeOf = (places: TransferCompassPlace[]) => new Map(places.flatMap(p => p.keys.map(k => [k, p] as const)))
  const fromPlace = placeOf(compass.from)
  const toPlace = placeOf(compass.to)
  const flows: TransferRoseFlow[] = []
  // The flows' destinations' routes, from the summaries' trips; and each
  // place's connections, counted at both ends.
  const routeIds = new Map<string, number>()
  const totals = new Map<string, number>()
  for (const { from, pairs } of summaries) {
    const origin = fromPlace.get(from.key)
    for (const p of pairs) {
      const destination = toPlace.get(p.to.key)
      const grades: TransferGradeCounts = { missed: 0, close: 0, acceptable: 0, unacceptable: 0 }
      for (const g of p.overview.grades) {
        grades[g.grade] = g.count
      }
      const total = p.overview.connections
      if (origin && destination && total > 0) {
        flows.push({ from: origin.key, to: destination.key, fromKey: from.key, toKey: p.to.key, grades, total })
        routeIds.set(from.key, from.routeId)
        routeIds.set(p.to.key, p.to.routeId)
        totals.set(origin.key, (totals.get(origin.key) ?? 0) + total)
        totals.set(destination.key, (totals.get(destination.key) ?? 0) + total)
      }
    }
  }
  const places = new Map<string, TransferRosePlace>()
  for (const [list, side] of [[compass.from, 'fromKeys'], [compass.to, 'toKeys']] as const) {
    for (const p of list) {
      const total = totals.get(p.key)
      if (total !== undefined) {
        const place = places.get(p.key) ?? { key: p.key, name: p.name, bearing: p.bearing, km: p.km, total, fromKeys: [], toKeys: [] }
        place[side] = p.keys
        places.set(p.key, place)
      }
    }
  }
  const trips = (byKey: RoseTripInfo['from'], keys: Set<string>) => new Map([...keys].map((key) => {
    const route = info.routes.get(routeIds.get(key)!)
    return [key, { route: routeLabel(route), agency: route?.agency_name ?? '', label: byKey.get(key)?.label ?? '' }] as const
  }))
  return {
    places: [...places.values()].sort((a, b) => a.bearing - b.bearing),
    flows: flows.sort((a, b) => b.total - a.total),
    from: trips(info.from, new Set(flows.map(f => f.fromKey))),
    to: trips(info.to, new Set(flows.map(f => f.toKey))),
  }
}
