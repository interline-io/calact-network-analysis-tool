import { gql } from 'graphql-tag'

//////////
// Stop departures
//////////

export const stopDepartureQuery = gql`
fragment departure on StopTime {
  departure_time
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
    monday: stop_times(limit: 10000, where: {date: $monday}) @include(if: $include_monday) {
      ...departure
    }
    tuesday: stop_times(limit: 10000, where: {date: $tuesday}) @include(if: $include_tuesday) {
      ...departure
    }
    wednesday: stop_times(limit: 10000, where: {date: $wednesday}) @include(if: $include_wednesday) {
      ...departure
    }
    thursday: stop_times(limit: 10000, where: {date: $thursday}) @include(if: $include_thursday) {
      ...departure
    }
    friday: stop_times(limit: 10000, where: {date: $friday}) @include(if: $include_friday) {
      ...departure
    }
    saturday: stop_times(limit: 10000, where: {date: $saturday}) @include(if: $include_saturday) {
      ...departure
    }
    sunday: stop_times(limit: 10000, where: {date: $sunday}) @include(if: $include_sunday) {
      ...departure
    }    
  }
}`

export interface StopTime {
  departure_time: string
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
