import { gql } from 'graphql-tag'
import { format } from 'date-fns'

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

export class StopDepartureQueryVars {
  ids: number[] = []
  monday: string = ''
  tuesday: string = ''
  wednesday: string = ''
  thursday: string = ''
  friday: string = ''
  saturday: string = ''
  sunday: string = ''
  include_monday: boolean = false
  include_tuesday: boolean = false
  include_wednesday: boolean = false
  include_thursday: boolean = false
  include_friday: boolean = false
  include_saturday: boolean = false
  include_sunday: boolean = false

  get(dow: string): string {
    switch (dow) {
      case 'monday':
        return this.monday
      case 'tuesday':
        return this.tuesday
      case 'wednesday':
        return this.wednesday
      case 'thursday':
        return this.thursday
      case 'friday':
        return this.friday
      case 'saturday':
        return this.saturday
      case 'sunday':
        return this.sunday
    }
    return ''
  }

  setDay(d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0:
        this.sunday = format(d, dateFmt)
        this.include_sunday = true
        break
      case 1:
        this.monday = format(d, dateFmt)
        this.include_monday = true
        break
      case 2:
        this.tuesday = format(d, dateFmt)
        this.include_tuesday = true
        break
      case 3:
        this.wednesday = format(d, dateFmt)
        this.include_wednesday = true
        break
      case 4:
        this.thursday = format(d, dateFmt)
        this.include_thursday = true
        break
      case 5:
        this.friday = format(d, dateFmt)
        this.include_friday = true
        break
      case 6:
        this.saturday = format(d, dateFmt)
        this.include_saturday = true
        break
    }
  }
}
