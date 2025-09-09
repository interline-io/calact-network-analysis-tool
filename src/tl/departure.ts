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
    monday: departures(limit: 1000, where: {date: $monday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_monday) {
      ...departure
    }
    tuesday: departures(limit: 1000, where: {date: $tuesday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_tuesday) {
      ...departure
    }
    wednesday: departures(limit: 1000, where: {date: $wednesday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_wednesday) {
      ...departure
    }
    thursday: departures(limit: 1000, where: {date: $thursday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_thursday) {
      ...departure
    }
    friday: departures(limit: 1000, where: {date: $friday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_friday) {
      ...departure
    }
    saturday: departures(limit: 1000, where: {date: $saturday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_saturday) {
      ...departure
    }
    sunday: departures(limit: 1000, where: {date: $sunday, start: "00:00:00", end: "23:59:59"}) @include(if: $include_sunday) {
      ...departure
    }    
  }
}`

export interface StopTime {
  departure_time: string
  trip: {
    id: number
    direction_id: number
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
