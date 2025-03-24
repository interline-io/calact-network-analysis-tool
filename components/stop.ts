import { gql } from 'graphql-tag'
import { format } from 'date-fns'
import { StopDepartureCache } from './departure'

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

const dowDateString = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

//////////////////////////////////////
//////////////////////////////////////
//////////////////////////////////////

// Mutates calculated fields on Stop
export function stopSetDerived(
  stop: Stop,
  selectedDows: string[],
  selectedDowMode: string,
  selectedDateRange: Date[],
  selectedRouteTypes: string[],
  selectedAgencies: string[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null,) {
  // Apply filters
  stop.marked = stopFilter(
    stop, 
    selectedDows, 
    selectedDowMode, 
    selectedDateRange, 
    selectedRouteTypes, 
    selectedAgencies, 
    sdCache,
  )
  stop.visits = stopVisits(
    stop, 
    selectedDows, 
    selectedDateRange, 
    selectedStartTime,
    selectedEndTime,  
    sdCache,
  )
}

export function stopVisits(
  stop: StopGql,
  selectedDows: string[],
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
  for (const sd of selectedDateRange) {
    const sdDow = dowDateString[sd.getDay()] || ''
    if (!selectedDows.includes(sdDow)) {
      continue
    }
    // TODO: memoize formatted date
    const stopDeps = sdCache.get(stop.id, format(sd, 'yyyy-MM-dd'))
    let count = 0
    for (const dep of stopDeps) {
      if (dep.departure_time >= selectedStartTime && dep.departure_time <= selectedEndTime) {
        count += 1
      }
    }
    result.total.date_count += 1
    result.total.visit_count += count
    result.total.visit_average = checkDiv(result.total.visit_count, result.total.date_count)
    let r = result.total
    switch (sd.getDay()) {
      case 0:
        r  = result.sunday
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
  }
  console.log('stopVisitResult:', stop.id, 'counts:', result)
  return result
}

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
    visit_count_wednesday_average:Math.round(stop.visits.wednesday.visit_average),
    visit_count_thursday_average:Math.round( stop.visits.thursday.visit_average),
    visit_count_friday_average: Math.round(stop.visits.friday.visit_average),
    visit_count_saturday_average: Math.round(stop.visits.saturday.visit_average),
    visit_count_sunday_average: Math.round(stop.visits.sunday.visit_average),
  }
}

// Filter stops
export function stopFilter(
  stop: StopGql,
  selectedDows: string[],
  selectedDowMode: string,
  selectedDateRange: Date[],
  selectedRouteTypes: string[],
  selectedAgencies: string[],
  sdCache: StopDepartureCache | null,
): boolean {
  // Check departure days
  if (selectedDows.length > 0 && sdCache) {
    // For each day in selected date range,
    // check if stop has service on that day.
    // Skip if not in selected week days
    // hasAny: stop has service on at least one selected day of week
    // hasAll: stop has service on all selected days of week
    let hasAny = false
    let hasAll = true
    for (const sd of selectedDateRange) {
      const sdDow = dowDateString[sd.getDay()] || ''
      if (!selectedDows.includes(sdDow)) {
        continue
      }
      // TODO: memoize formatted date
      const hasService = sdCache.hasService(stop.id, format(sd, 'yyyy-MM-dd'))
      if (hasService) {
        hasAny = true
      } else {
        hasAll = false
      }
      // console.log('stopFilter:', stop.id, sdDow, format(sd, 'yyyy-MM-dd'))
    }
    // console.log('stopFilter:', stop.id, 'hasAny:', hasAny, 'hasAll:', hasAll)
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
    visit_average: -1
  }
}

function checkDiv(a: number, b: number):number{ 
  return b === 0 ? 0 : a / b
}
