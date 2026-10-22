/**
 * The places trips at the stops come from and go to, laid out around the
 * stops as on a compass: each place by its bearing and distance from them.
 *
 * Bearings and distances are flat-earth arithmetic on coordinates, close
 * enough over a region to place a mark on a diagram; they are never
 * reported as figures.
 */

import { TRANSFER_GRADES, type TransferArrivalSummary, type TransferGrade, type TransferRouteChoice } from './transfers'

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

function noGrades (): TransferGradeCounts {
  return { missed: 0, close: 0, acceptable: 0, unacceptable: 0 }
}

/**
 * Connections by grade for each destination: for arriving ones ('from'), the
 * connections their trips make; for departing ones ('to'), those made onto
 * their trips.
 */
export function transferCompassFlows (summaries: TransferArrivalSummary[], side: 'from' | 'to'): Map<string, TransferGradeCounts> {
  const flows = new Map<string, TransferGradeCounts>()
  const add = (key: string, counts: Partial<TransferGradeCounts>) => {
    const total = flows.get(key) ?? noGrades()
    for (const g of TRANSFER_GRADES) {
      total[g] += counts[g] ?? 0
    }
    flows.set(key, total)
  }
  for (const { from, overview, pairs } of summaries) {
    if (side === 'from') {
      add(from.key, Object.fromEntries(overview.grades.map(g => [g.grade, g.count])))
    } else {
      for (const p of pairs) {
        add(p.to.key, p)
      }
    }
  }
  return flows
}

// Connections by grade summed over some destinations.
export function sumGrades (flows: Map<string, TransferGradeCounts>, keys: string[]): TransferGradeCounts {
  const total = noGrades()
  for (const key of keys) {
    const counts = flows.get(key)
    for (const g of TRANSFER_GRADES) {
      total[g] += counts?.[g] ?? 0
    }
  }
  return total
}
