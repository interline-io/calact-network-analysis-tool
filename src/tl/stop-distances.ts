// Distances between stops, from the Transitland directions API: straight-line
// (mode LINE) or along the street network (mode WALK). The server computes
// both; nothing here measures geometry.

import { gql } from 'graphql-tag'

export type StopDistanceMode = 'LINE' | 'WALK'

export interface StopPoint {
  id: number
  lon: number
  lat: number
}

// A pair of stops, either way round, as a map key.
export function stopPairKey (a: number, b: number): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Each unordered pair of distinct stops, once.
export function stopPairs (stops: StopPoint[]): [StopPoint, StopPoint][] {
  const pairs: [StopPoint, StopPoint][] = []
  for (let i = 0; i < stops.length; i++) {
    for (let j = i + 1; j < stops.length; j++) {
      pairs.push([stops[i]!, stops[j]!])
    }
  }
  return pairs
}

// Pairs per request: one aliased `directions` field each.
export const STOP_DISTANCE_BATCH_SIZE = 50

// One request for a batch of pairs, each pair an aliased `directions` field
// with its own waypoint variables.
export function stopDistancesRequest (pairs: [StopPoint, StopPoint][], mode: StopDistanceMode) {
  const vars: Record<string, unknown> = { mode }
  const decls = ['$mode: StepMode!']
  const fields = pairs.map(([a, b], i) => {
    decls.push(`$f${i}: WaypointInput!`, `$t${i}: WaypointInput!`)
    vars[`f${i}`] = { lon: a.lon, lat: a.lat }
    vars[`t${i}`] = { lon: b.lon, lat: b.lat }
    return `p${i}: directions(where: {from: $f${i}, to: $t${i}, mode: $mode}) { success distance { distance units } }`
  })
  return {
    query: gql(`query StopDistances(${decls.join(', ')}) {\n  ${fields.join('\n  ')}\n}`),
    variables: vars,
  }
}

export interface StopDistancesResponse {
  [alias: string]: {
    success: boolean
    distance?: { distance: number, units: 'KILOMETERS' | 'METERS' | 'MILES' } | null
  } | null
}

const METERS_PER_UNIT = { KILOMETERS: 1000, METERS: 1, MILES: 1609.344 } as const

// Meters for each pair the server could route, by stopPairKey.
export function parseStopDistances (pairs: [StopPoint, StopPoint][], data: StopDistancesResponse | undefined): Map<string, number> {
  const meters = new Map<string, number>()
  pairs.forEach(([a, b], i) => {
    const d = data?.[`p${i}`]
    if (d?.success && d.distance) {
      meters.set(stopPairKey(a.id, b.id), d.distance.distance * METERS_PER_UNIT[d.distance.units])
    }
  })
  return meters
}
