import { gql } from 'graphql-tag'

//////////
// Stop departures
//////////

export const stopDepartureQuery = gql`
fragment departure on StopTime {
  departure_time
  pickup_type
  trip {
    id
    direction_id
    trip_id
    route {
      id
    }
  }
}

query (
  $ids: [Int!],
  $monday: Date,
  $tuesday: Date,
  $wednesday: Date,
  $thursday: Date,
  $friday: Date,
  $saturday: Date,
  $sunday: Date,
  $include_monday: Boolean!,
  $include_tuesday: Boolean!,
  $include_wednesday: Boolean!,
  $include_thursday: Boolean!,
  $include_friday: Boolean!,
  $include_saturday: Boolean!,
  $include_sunday: Boolean!
) {
  stops(ids: $ids) {
    id
    monday: departures(limit: 10000, where: {use_service_window: true, date: $monday}) @include(if: $include_monday) {
      ...departure
    }
    tuesday: departures(limit: 10000, where: {use_service_window: true, date: $tuesday}) @include(if: $include_tuesday) {
      ...departure
    }
    wednesday: departures(limit: 10000, where: {use_service_window: true, date: $wednesday}) @include(if: $include_wednesday) {
      ...departure
    }
    thursday: departures(limit: 10000, where: {use_service_window: true, date: $thursday}) @include(if: $include_thursday) {
      ...departure
    }
    friday: departures(limit: 10000, where: {use_service_window: true, date: $friday}) @include(if: $include_friday) {
      ...departure
    }
    saturday: departures(limit: 10000, where: {use_service_window: true, date: $saturday}) @include(if: $include_saturday) {
      ...departure
    }
    sunday: departures(limit: 10000, where: {use_service_window: true, date: $sunday}) @include(if: $include_sunday) {
      ...departure
    }    
  }
}`

export const stopTimeQuery = gql`
fragment departure on StopTime {
  departure_time
  pickup_type
  trip {
    id
    direction_id
    trip_id
    route {
      id
    }
  }
}

query (
  $ids: [Int!],
  $monday: Date,
  $tuesday: Date,
  $wednesday: Date,
  $thursday: Date,
  $friday: Date,
  $saturday: Date,
  $sunday: Date,
  $include_monday: Boolean!,
  $include_tuesday: Boolean!,
  $include_wednesday: Boolean!,
  $include_thursday: Boolean!,
  $include_friday: Boolean!,
  $include_saturday: Boolean!,
  $include_sunday: Boolean!
) {
  stops(ids: $ids) {
    id
    monday: stop_times(limit: 10000, where: {use_service_window: true, date: $monday}) @include(if: $include_monday) {
      ...departure
    }
    tuesday: stop_times(limit: 10000, where: {use_service_window: true, date: $tuesday}) @include(if: $include_tuesday) {
      ...departure
    }
    wednesday: stop_times(limit: 10000, where: {use_service_window: true, date: $wednesday}) @include(if: $include_wednesday) {
      ...departure
    }
    thursday: stop_times(limit: 10000, where: {use_service_window: true,  date: $thursday}) @include(if: $include_thursday) {
      ...departure
    }
    friday: stop_times(limit: 10000, where: {use_service_window: true,  date: $friday}) @include(if: $include_friday) {
      ...departure
    }
    saturday: stop_times(limit: 10000, where: {use_service_window: true,  date: $saturday}) @include(if: $include_saturday) {
      ...departure
    }
    sunday: stop_times(limit: 10000, where: {use_service_window: true,  date: $sunday}) @include(if: $include_sunday) {
      ...departure
    }    
  }
}`

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

export interface StopDeparture {
  id: number
  monday: StopTime[]
  tuesday: StopTime[]
  wednesday: StopTime[]
  thursday: StopTime[]
  friday: StopTime[]
  saturday: StopTime[]
  sunday: StopTime[]
}

//////////
// Route -> trips -> stop times
//////////

// One request per route batch instead of one per (stop chunk × date). Trip
// identity and service dates are stated once rather than on every stop time.
export const routeTripsQuery = gql`
query ($ids: [Int!], $dates: [Date!], $stopIds: [Int!], $limit: Int) {
  routes(ids: $ids, limit: $limit) {
    id
    trips(limit: 100000, where: {dates: $dates, use_service_window: true}) {
      id
      direction_id
      trip_id
      service_dates
      stop_times(limit: 100000, where: {stop_ids: $stopIds}) {
        stop {
          id
        }
        departure_time
        pickup_type
      }
    }
  }
}`

// A trip's stop times, with the dates the trip runs stated once.
export interface RouteTripStopTime {
  stop: { id: number }
  departure_time: string
  pickup_type?: number | null
}

export interface RouteTrip {
  id: number
  direction_id: number
  trip_id: string
  service_dates: string[]
  stop_times: RouteTripStopTime[]
}

export interface RouteTripsResponse {
  id: number
  trips: RouteTrip[]
}
