import { gql } from 'graphql-tag'
import { parseHMS } from '../core'

// What the trip panel (#476) says about a trip beyond its time at a stop: where
// it is headed, when it starts and ends, and how many stops it makes. The
// scenario's departure cache only holds stop times inside the scenario area, so
// a trip's full run comes from the trip itself, fetched for the trips a panel
// shows rather than for every trip in the scenario.

export const tripDetailsQuery = gql`
query TripDetails($ids: [Int!], $limit: Int) {
  trips(ids: $ids, limit: $limit) {
    id
    trip_id
    trip_headsign
    stop_times(limit: 1000) {
      arrival_time
      departure_time
    }
  }
}`

// Trips per request: the stop times of each come back with it, so a request
// stays a few thousand rows.
export const TRIP_DETAILS_CHUNK_SIZE = 100

export interface TripDetailsResponse {
  trips: {
    id: number
    trip_id: string
    trip_headsign?: string | null
    stop_times: {
      arrival_time?: number | string | null
      departure_time?: number | string | null
    }[]
  }[]
}

export interface TripDetail {
  id: number
  tripId: string
  headsign?: string
  // Seconds since midnight; may run past 24:00 for after-midnight trips.
  startTime?: number
  endTime?: number
  stopCount: number
}

// The API returns Seconds as "HH:MM:SS"; accept a number too.
function toSeconds (v: number | string | null | undefined): number | undefined {
  if (typeof v === 'number') {
    return v
  }
  const s = parseHMS(v)
  return s < 0 ? undefined : s
}

export function parseTripDetails (data: TripDetailsResponse | undefined): TripDetail[] {
  return (data?.trips || []).map((t) => {
    // The trip starts at its earliest departure and ends at its latest
    // arrival; either side falls back to the other time where the feed left
    // one blank.
    let startTime: number | undefined
    let endTime: number | undefined
    for (const st of t.stop_times) {
      const dep = toSeconds(st.departure_time) ?? toSeconds(st.arrival_time)
      const arr = toSeconds(st.arrival_time) ?? toSeconds(st.departure_time)
      if (dep !== undefined && (startTime === undefined || dep < startTime)) {
        startTime = dep
      }
      if (arr !== undefined && (endTime === undefined || arr > endTime)) {
        endTime = arr
      }
    }
    return {
      id: t.id,
      tripId: t.trip_id,
      headsign: t.trip_headsign || undefined,
      startTime,
      endTime,
      stopCount: t.stop_times.length,
    }
  })
}
