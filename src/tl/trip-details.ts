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
      stop_sequence
      arrival_time
      departure_time
      stop_headsign
      stop {
        id
        stop_name
      }
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
    // Elements are nullable in the schema: a stop time whose stop the API
    // cannot return comes back null, with an error, rather than failing the
    // trip.
    stop_times: ({
      stop_sequence?: number
      arrival_time?: number | string | null
      departure_time?: number | string | null
      stop_headsign?: string | null
      stop?: { id: number, stop_name?: string | null } | null
    } | null)[]
  }[]
}

export interface TripDetail {
  id: number
  tripId: string
  headsign?: string
  // GTFS stop_headsign by stop, where the feed sets one; it overrides the trip
  // headsign at that stop only. Feeds such as TriMet's leave the trip headsign
  // blank and sign every stop instead.
  stopHeadsigns: Map<number, string>
  lastStopName?: string
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
    // A null stop time still counts as a stop the trip makes, but has no times
    // or headsign to read.
    const stopTimes = t.stop_times
      .filter(st => st != null)
      .sort((a, b) => (a.stop_sequence ?? 0) - (b.stop_sequence ?? 0))
    const stopHeadsigns = new Map<number, string>()
    for (const st of stopTimes) {
      // A stop called twice keeps the sign from its first call.
      if (st.stop_headsign && st.stop && !stopHeadsigns.has(st.stop.id)) {
        stopHeadsigns.set(st.stop.id, st.stop_headsign)
      }
    }
    for (const st of stopTimes) {
      const depTime = toSeconds(st.departure_time)
      const arrTime = toSeconds(st.arrival_time)
      const dep = depTime ?? arrTime
      const arr = arrTime ?? depTime
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
      stopHeadsigns,
      lastStopName: stopTimes[stopTimes.length - 1]?.stop?.stop_name || undefined,
      startTime,
      endTime,
      stopCount: t.stop_times.length,
    }
  })
}

// What a rider sees signed on a trip leaving a stop: the stop's headsign, the
// trip's, or failing both the stop it runs to.
export function tripHeadsignAt (detail: TripDetail, stopId: number): string | undefined {
  return detail.stopHeadsigns.get(stopId) || detail.headsign || detail.lastStopName
}
