import { gql } from 'graphql-tag'
import type { RouteTripFrequency } from './departure'

//////////
// Route -> stop patterns -> timetables, for vehicle playback
//////////

// A route's trips on two service days, a stop pattern at a time, with each
// stop's distance along its trip's shape. The fragment is the selection both
// days share. The frequencies' trip back-reference is the anchor
// frequencySchedule reads.
export const routeVehicleTimetablesQuery = gql`
query RouteVehicleTimetables($ids: [Int!], $prev: Date!, $day: Date!) {
  routes(ids: $ids, limit: 1) {
    id
    prev: patterns(where: {service_date: $prev, use_service_window: true}) {
      ...VehiclePattern
    }
    day: patterns(where: {service_date: $day, use_service_window: true}) {
      ...VehiclePattern
    }
  }
}

fragment VehiclePattern on RouteStopPattern {
  timetable {
    trips {
      id
      shape {
        id
      }
      frequencies {
        start_time
        end_time
        headway_secs
        trip {
          stop_times(limit: 1) {
            departure_time
          }
        }
      }
    }
    arrival_times {
      values
    }
    departure_times {
      values
    }
    shape_distances {
      values
    }
  }
}`

// The shapes those runs follow, through one trip apiece: the geometry, and
// the distance at each of its points in the measure shape_distances uses.
export const vehicleShapesQuery = gql`
query VehicleShapes($ids: [Int!], $limit: Int) {
  trips(ids: $ids, limit: $limit) {
    shape {
      id
      geometry
      distances
    }
  }
}`

// One stop pattern's trips on a service day. In every grid, row i is a stop
// and column j is trips[j].
export interface VehiclePattern {
  // Null for a pattern of flex trips only.
  timetable: {
    trips: {
      id: number
      shape: { id: number } | null
      frequencies?: RouteTripFrequency[]
    }[]
    arrival_times: { values: (string | null)[][] }
    departure_times: { values: (string | null)[][] }
    // Meters along the trip's shape; null for a trip without one.
    shape_distances: { values: (number | null)[][] }
  } | null
}

export interface RouteVehicleTimetablesResponse {
  id: number
  prev: VehiclePattern[] | null
  day: VehiclePattern[] | null
}

export interface VehicleShapesResponse {
  trips: {
    shape: {
      id: number
      geometry: GeoJSON.LineString
      distances: number[]
    } | null
  }[]
}

// One vehicle's run through a day: a trip on one service date, or one
// repetition of a frequency-based trip. Each entry is a time the vehicle is at
// a stop, and that stop's distance along the run's shape; a stop where it
// waits appears twice, at arrival and at departure.
export interface VehicleTrack {
  tripId: number
  routeId: number
  shapeId: number
  // Seconds from midnight of the day, ascending. A run that began the evening
  // before reads negative; one that runs past midnight reads past 86400.
  times: number[]
  // Meters along the shape at each of times.
  distances: number[]
}

// A shape runs follow: [lon, lat] at each of its points, flattened, and the
// distance along the shape at each, in meters.
export interface VehicleShape {
  id: number
  coords: number[]
  distances: number[]
}

// How far along its shape a track's vehicle is at a time, in meters, or
// undefined outside its run. It moves at an even speed between stops.
export function vehicleDistance (track: VehicleTrack, time: number): number | undefined {
  const { times, distances } = track
  const n = times.length
  if (n === 0 || time < times[0]! || time > times[n - 1]!) {
    return undefined
  }
  for (let i = 1; i < n; i++) {
    const t1 = times[i]!
    if (time > t1) {
      continue
    }
    const t0 = times[i - 1]!
    const f = t1 > t0 ? (time - t0) / (t1 - t0) : 1
    return distances[i - 1]! + (distances[i]! - distances[i - 1]!) * f
  }
  return distances[n - 1]
}

// The point a distance along a shape, between the two of its points whose
// distances bracket it; clamped to the shape's ends.
export function shapePoint (shape: VehicleShape, distance: number): [number, number] {
  const { coords, distances } = shape
  const n = distances.length
  if (distance <= distances[0]!) {
    return [coords[0]!, coords[1]!]
  }
  if (distance >= distances[n - 1]!) {
    return [coords[2 * n - 2]!, coords[2 * n - 1]!]
  }
  // The last point at or before the distance.
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (distances[mid]! <= distance) {
      lo = mid
    } else {
      hi = mid
    }
  }
  const d0 = distances[lo]!
  const f = distances[hi]! > d0 ? (distance - d0) / (distances[hi]! - d0) : 0
  const lon0 = coords[2 * lo]!
  const lat0 = coords[2 * lo + 1]!
  return [lon0 + (coords[2 * hi]! - lon0) * f, lat0 + (coords[2 * hi + 1]! - lat0) * f]
}

// Where a track's vehicle is at a time, or undefined outside its run.
export function vehiclePosition (track: VehicleTrack, shape: VehicleShape, time: number): [number, number] | undefined {
  const d = vehicleDistance(track, time)
  return d === undefined ? undefined : shapePoint(shape, d)
}
