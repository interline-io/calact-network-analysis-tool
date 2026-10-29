import { gql } from 'graphql-tag'
import type { RouteTripFrequency } from './departure'

//////////
// Route -> trips -> every stop time, for vehicle playback
//////////

// Unlike routeTripsQuery, stop times are not filtered to the scenario's stops:
// a vehicle runs its whole trip, inside the area or not. The frequencies'
// trip back-reference is the anchor frequencySchedule reads.
export const routeVehicleTripsQuery = gql`
query RouteVehicleTrips($ids: [Int!], $dates: [Date!], $limit: Int) {
  routes(ids: $ids, limit: $limit) {
    id
    trips(limit: 100000, where: {dates: $dates, use_service_window: true}) {
      id
      service_dates
      stop_times(limit: 1000) {
        stop_sequence
        arrival_time
        departure_time
        stop {
          geometry
        }
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
  }
}`

export interface RouteVehicleTripsResponse {
  id: number
  trips: {
    id: number
    service_dates: string[]
    // Elements are nullable in the schema, as in tripDetailsQuery.
    stop_times: ({
      stop_sequence: number
      arrival_time: string | null
      departure_time: string | null
      stop: { geometry: GeoJSON.Point } | null
    } | null)[]
    frequencies?: RouteTripFrequency[]
  }[]
}

// One vehicle's run through a day: a trip on one service date, or one
// repetition of a frequency-based trip. Each entry is a time the vehicle is at
// a stop; a stop where it waits appears twice, at arrival and at departure.
export interface VehicleTrack {
  tripId: number
  routeId: number
  // Seconds from midnight of the day, ascending. A run that began the evening
  // before reads negative; one that runs past midnight reads past 86400.
  times: number[]
  // [lon, lat] at each of times, flattened.
  coords: number[]
}

// Where a track's vehicle is at a time, or undefined outside its run. Moves in
// a straight line between stops: a straight segment between known points, not
// a geometry operation.
export function vehiclePosition (track: VehicleTrack, time: number): [number, number] | undefined {
  const { times, coords } = track
  const n = times.length
  if (n === 0 || time < times[0]! || time > times[n - 1]!) {
    return undefined
  }
  if (n === 1) {
    return [coords[0]!, coords[1]!]
  }
  for (let i = 1; i < n; i++) {
    const t1 = times[i]!
    if (time > t1) {
      continue
    }
    const t0 = times[i - 1]!
    const f = t1 > t0 ? (time - t0) / (t1 - t0) : 1
    const lon0 = coords[2 * i - 2]!
    const lat0 = coords[2 * i - 1]!
    return [lon0 + (coords[2 * i]! - lon0) * f, lat0 + (coords[2 * i + 1]! - lat0) * f]
  }
  return undefined
}
