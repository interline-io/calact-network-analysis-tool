// Distances between stops, from the Transitland directions API: straight-line
// (mode LINE) or along the street network (mode WALK). The server computes
// both; nothing here measures geometry.

import { gql } from 'graphql-tag'

// The directions API mode: a straight line, or the street network.
export type StopDistanceMode = 'LINE' | 'WALK'

// A stop's id and location.
export interface StopPoint {
  id: number
  lon: number
  lat: number
}

// A pair of stops, in either order, as a map key.
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

// The distance between one pair of points. The API routes one pair per
// field, so each pair is a request of its own.
export const stopDistanceQuery = gql`
query StopDistance($from: WaypointInput!, $to: WaypointInput!, $mode: StepMode!) {
  directions(where: {from: $from, to: $to, mode: $mode}) {
    success
    distance {
      distance
      units
    }
  }
}`

// The variables for stopDistanceQuery: the two stops' locations and the mode.
export function stopDistanceVariables (a: StopPoint, b: StopPoint, mode: StopDistanceMode) {
  return { from: { lon: a.lon, lat: a.lat }, to: { lon: b.lon, lat: b.lat }, mode }
}

// The response to stopDistanceQuery.
export interface StopDistanceResponse {
  directions?: {
    success: boolean
    distance?: { distance: number, units: 'KILOMETERS' | 'METERS' | 'MILES' } | null
  } | null
}

const METERS_PER_UNIT: Record<string, number> = { KILOMETERS: 1000, METERS: 1, MILES: 1609.344 }

// The pair's meters, where the server could route it; none for an unrouted
// pair, or a distance in a unit it does not know.
export function parseStopDistance (data: StopDistanceResponse | undefined): number | undefined {
  const d = data?.directions
  const meters = d?.success && d.distance ? d.distance.distance * (METERS_PER_UNIT[d.distance.units] ?? Number.NaN) : Number.NaN
  return Number.isFinite(meters) ? meters : undefined
}
