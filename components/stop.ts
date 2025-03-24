import { gql } from 'graphql-tag'
import { format } from 'date-fns'
import { StopDepartureCache } from './departure'
import { type dow } from './constants'
import { parseHMS } from './datetime'
//////////
// Stops
//////////

export const stopQuery = gql`
query ($limit: Int, $after: Int, $where: StopFilter) {
  stops(limit: $limit, after: $after, where: $where) {
    id
    location_type
    stop_id
    stop_name
    stop_code
    stop_desc
    stop_timezone
    stop_url
    zone_id
    wheelchair_boarding
    platform_code
    tts_stop_name
    geometry
    route_stops {
      route {
        id
        route_id
        route_type
        route_short_name
        route_long_name
        agency {
          id
          agency_id
          agency_name
        }
      }
    }
  }
}`

export interface StopGtfs {
  location_type: number
  stop_id: string
  stop_name?: string
  stop_code?: string
  stop_desc?: string
  stop_timezone?: string
  stop_url?: string
  zone_id?: string
  wheelchair_boarding?: number
  platform_code?: string
  tts_stop_name?: string
}

export interface StopDerived {
  marked: boolean
  modes: string
  number_served: number
  visits: StopVisitSummary
}

export interface StopVisitCounts {
  visit_average: number
  visit_count: number
  date_count: number,
  all_date_service: boolean
}


export interface StopVisitSummary {
  total: StopVisitCounts
  monday: StopVisitCounts
  tuesday: StopVisitCounts
  wednesday: StopVisitCounts
  thursday: StopVisitCounts
  friday: StopVisitCounts
  saturday: StopVisitCounts
  sunday: StopVisitCounts
}

export type StopGql = {
  id: number
  geometry: GeoJSON.Point
  route_stops: {
    route: {
      id: number
      route_id: string
      route_type: number
      route_short_name: string
      route_long_name: string
      agency: {
        id: number
        agency_id: string
        agency_name: string
      }
    }
  }[]
} & StopGtfs

export type StopCsv = StopGtfs & {
  row: number
  modes: string
  number_served: number
  marked: boolean
  visit_count_daily_average: number
  visit_count_monday_average: number
  visit_count_tuesday_average: number
  visit_count_wednesday_average: number
  visit_count_thursday_average: number
  visit_count_friday_average: number
  visit_count_saturday_average: number
  visit_count_sunday_average: number
}

export type Stop = StopGql & StopDerived

const dowDateString: dow[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

//////////////////////////////////////
// Stop filtering
//////////////////////////////////////

// Mutates calculated fields on Stop
export function stopSetDerived(
  stop: Stop,
  selectedDows: dow[],
  selectedDowMode: string,
  selectedDateRange: Date[],
  selectedRouteTypes: string[],
  selectedAgencies: string[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null,) {
  // Apply filters
  // Make sure to run stopVisits before stopMarked
  stop.visits = stopVisits(
    stop,
    selectedDows,
    selectedDateRange,
    selectedStartTime,
    selectedEndTime,
    sdCache,
  )
  stop.marked = stopMarked(
    stop,
    selectedDows,
    selectedDowMode,
    selectedDateRange,
    selectedRouteTypes,
    selectedAgencies,
    sdCache,
  )
}

export function stopVisits(
  stop: StopGql,
  selectedDows: dow[],
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null,
): StopVisitSummary {
  let result = {
    monday: newStopVisitCounts(),
    tuesday: newStopVisitCounts(),
    wednesday: newStopVisitCounts(),
    thursday: newStopVisitCounts(),
    friday: newStopVisitCounts(),
    saturday: newStopVisitCounts(),
    sunday: newStopVisitCounts(),
    total: newStopVisitCounts(),
  }
  if (!sdCache) {
    return result
  }
  const startTime = parseHMS(selectedStartTime)
  const endTime = parseHMS(selectedEndTime)
  for (const sd of selectedDateRange) {
    const sdDow = dowDateString[sd.getDay()] || ''
    if (!selectedDows.includes(sdDow)) {
      continue
    }
    // TODO: memoize formatted date
    const stopDepTimes = sdCache.get(stop.id, format(sd, 'yyyy-MM-dd')).map((st) => {return parseHMS(st.departure_time)})
    let count = 0
    for (const depTime of stopDepTimes) {
      if (depTime >= startTime && depTime <= endTime) {
        count += 1
      }
    }
    result.total.date_count += 1
    result.total.visit_count += count
    result.total.visit_average = checkDiv(result.total.visit_count, result.total.date_count)
    let r = result.total
    switch (sd.getDay()) {
      case 0:
        r = result.sunday
        break
      case 1:
        r = result.monday
        break
      case 2:
        r = result.tuesday
        break
      case 3:
        r = result.wednesday
        break
      case 4:
        r = result.thursday
        break
      case 5:
        r = result.friday
        break
      case 6:
        r = result.saturday
        break
    }
    r.date_count += 1
    r.visit_count += count
    r.visit_average = checkDiv(r.visit_count, r.date_count)
    if (count === 0) {
      r.all_date_service = false
    }
  }
  // console.log('stopVisitResult:', stop.id, 'counts:', result)
  return result
}

// Filter stops
export function stopMarked(
  stop: Stop,
  selectedDows: dow[],
  selectedDowMode: string,
  selectedDateRange: Date[],
  selectedRouteTypes: string[],
  selectedAgencies: string[],
  sdCache: StopDepartureCache | null,
): boolean {
  // Check departure days
  if (sdCache) {
    // hasAny: stop has service on at least one selected day of week
    // hasAll: stop has service on all selected days of week
    let hasAny = false
    let hasAll = true
    for (const sd of selectedDows) {
      // if-else tree required to avoid arbitrary index into type
      let r: StopVisitCounts | null = null
      if (sd === 'sunday') { r = stop.visits.sunday }
      else if (sd === 'monday') { r = stop.visits.monday }
      else if (sd === 'tuesday') { r = stop.visits.tuesday }
      else if (sd === 'wednesday') { r = stop.visits.wednesday }
      else if (sd === 'thursday') { r = stop.visits.thursday }
      else if (sd === 'friday') { r = stop.visits.friday }
      else if (sd === 'saturday') { r = stop.visits.saturday }
      if (!r) { continue }
      if (r.visit_count > 0) {
        hasAny = true
      }
      if (!r.all_date_service) {
        hasAll = false
      }
    }
    // Check mode
    let found = false
    if (selectedDowMode === 'Any') {
      found = hasAny
    } else if (selectedDowMode === 'All') {
      found = hasAll
    }
    // Not found, no further processing
    if (!found) {
      return false
    }
  }

  // Check route types
  // Must match at least one route type
  if (selectedRouteTypes.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (selectedRouteTypes.includes(rs.route.route_type.toString())) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }

  // Check agencies
  // Must match at least one selected agency
  if (selectedAgencies.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (selectedAgencies.includes(rs.route.agency.agency_name)) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }

  // Default is to return true
  return true
}

function newStopVisitCounts(): StopVisitCounts {
  return {
    visit_count: 0,
    date_count: 0,
    visit_average: -1,
    all_date_service: true
  }
}

function checkDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

///////////////////////////
// Stop csv
///////////////////////////

export function stopToStopCsv(stop: Stop): StopCsv {
  return {
    row: 0,
    // GTFS properties
    location_type: stop.location_type,
    stop_id: stop.stop_id,
    stop_name: stop.stop_name,
    stop_desc: stop.stop_desc,
    stop_timezone: stop.stop_timezone,
    stop_url: stop.stop_url,
    zone_id: stop.zone_id,
    wheelchair_boarding: stop.wheelchair_boarding,
    platform_code: stop.platform_code,
    tts_stop_name: stop.tts_stop_name,
    // Derived properties
    marked: stop.marked,
    number_served: stop.number_served,
    modes: stop.modes,
    visit_count_daily_average: Math.round(stop.visits.total.visit_average),
    visit_count_monday_average: Math.round(stop.visits.monday.visit_average),
    visit_count_tuesday_average: Math.round(stop.visits.tuesday.visit_average),
    visit_count_wednesday_average: Math.round(stop.visits.wednesday.visit_average),
    visit_count_thursday_average: Math.round(stop.visits.thursday.visit_average),
    visit_count_friday_average: Math.round(stop.visits.friday.visit_average),
    visit_count_saturday_average: Math.round(stop.visits.saturday.visit_average),
    visit_count_sunday_average: Math.round(stop.visits.sunday.visit_average),
  }
}
