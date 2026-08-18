import { gql } from 'graphql-tag'

export interface StopTime {
  departure_time: string
  // GTFS stop_times.pickup_type; null when the feed omits it. 1 = no pickup
  // available (drop-off only), e.g. a loop's return to its terminal.
  pickup_type?: number | null
  trip: {
    id: number
    direction_id: number
    trip_id: string
    route: {
      id: number
    }
  }
}

//////////
// Route -> trips -> stop times
//////////

// One request per route batch instead of one per (stop chunk × date). Trip
// identity and service dates are stated once rather than on every stop time.
export const routeTripsQuery = gql`
query RouteTrips($ids: [Int!], $dates: [Date!], $stopIds: [Int!], $limit: Int) {
  routes(ids: $ids, limit: $limit) {
    id
    trips(limit: 100000, where: {dates: $dates, use_service_window: true}) {
      id
      direction_id
      trip_id
      service_dates
      stop_times(limit: 1000, where: {stop_ids: $stopIds}) {
        stop {
          id
        }
        departure_time
        pickup_type
      }
      frequencies {
        start_time
        end_time
        headway_secs
        # Only the first is read, as the anchor the generated departures are
        # measured from.
        trip {
          stop_times(limit: 1) {
            departure_time
          }
        }
      }
    }
  }
}`

// A trip's stop times, with the dates the trip runs stated once.
export interface RouteTripStopTime {
  stop: { id: number }
  // Null at a non-timepoint stop the feed left blank, which is common enough to
  // be worth stating: such a stop time is not a departure.
  departure_time: string | null
  pickup_type?: number | null
}

// A frequencies.txt entry. The trip's first departure comes back through the
// trip back-reference because the sibling stop_times selection is filtered to
// the scenario's stops and may not include the trip's first stop.
export interface RouteTripFrequency {
  start_time: string
  end_time: string
  headway_secs: number
  trip?: {
    stop_times: { departure_time: string | null }[]
  }
}

export interface RouteTrip {
  id: number
  direction_id: number
  trip_id: string
  service_dates: string[]
  stop_times: RouteTripStopTime[]
  // Present only for frequency-based trips, where stop_times is a travel-time
  // template rather than a set of real departures.
  frequencies?: RouteTripFrequency[]
}

export interface RouteTripsResponse {
  id: number
  trips: RouteTrip[]
}
