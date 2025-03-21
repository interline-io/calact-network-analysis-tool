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
  // Derived properties
  marked: boolean
  stop_modes: string
  routes_served_count: number
  average_visit_count: number
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

export type StopCsv = StopGtfs & StopDerived & { row: number }

export type Stop = StopGql & StopDerived

const dowDateString = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Filter stops
export function stopFilter (
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