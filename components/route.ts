import { gql } from 'graphql-tag'
import { type StopTime, StopDepartureCache } from './departure'
import { format } from 'date-fns'

//////////
// Routes
//////////

export const routeQuery = gql`
query ($limit: Int, $after: Int, $where: RouteFilter) {
  routes(limit: $limit, after: $after, where: $where) {
    id
    route_id
    route_short_name
    route_long_name
    route_type
    route_color
    route_text_color
    route_sort_order
    route_url
    route_desc
    continuous_pickup
    continuous_drop_off    
    geometry
    agency {
      id
      agency_id
      agency_name
      agency_email
      agency_url
      agency_timezone
      agency_lang
      agency_phone
      agency_fare_url
    }
  }
}`

export interface RouteGtfs {
  // GTFS properties
  route_id: string
  route_short_name: string
  route_long_name: string
  route_type: number
  route_color?: string
  route_text_color?: string
  route_sort_order?: number
  route_url?: string
  route_desc?: string
  continuous_pickup?: number
  continuous_drop_off?: number
}

export type RouteGql = {
  id: number
  geometry: GeoJSON.MultiLineString
  agency: {
    id: number
    agency_id: string
    agency_name: string
  }
} & RouteGtfs

export interface RouteDerived {
  [key: string]: any
  marked: boolean
  route_name: string
  agency_name: string
  mode: string
  headways: RouteHeadwaySummary
  average_frequency: number
  fastest_frequency: number
  slowest_frequency: number
}

export type RouteHeadwayCount = {
  stop_id: number
  direction: number
  headways_seconds: number[]
}

export type RouteHeadwayDirections = {
  dir0: RouteHeadwayCount
  dir1: RouteHeadwayCount
}

export type RouteHeadwaySummary = {
  total: RouteHeadwayDirections
  monday: RouteHeadwayDirections
}

export type RouteCsv = RouteGtfs & {
  row: number 
  marked: boolean
  route_name: string
  agency_name: string
  mode: string
  average_frequency: number
  fastest_frequency: number
  slowest_frequency: number
}

export type Route = RouteGql & RouteDerived

export function routeSetDerived (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  selectedRouteTypes: string[],
  selectedAgencies: string[],
  sdCache: StopDepartureCache | null,
) {
  // Set derived properties
  route.marked = routeMarked(route, selectedRouteTypes, selectedAgencies)
  if (sdCache) {
    routeHeadways(
      route,       
      selectedDateRange,
      selectedStartTime,
      selectedEndTime,
      sdCache,
    )
    route.average_frequency = 1
    route.fastest_frequency = 2
    route.slowest_frequency = 3  
  }
}


// Filter routes
export function routeMarked (route: RouteGql, srt: string[], sg: string[]): boolean {
  // Check route types
  if (srt.length > 0) {
    return srt.includes(route.route_type.toString())
  }

  // Check agencies
  if (sg.length > 0) {
    return sg.includes(route.agency.agency_name)
  }

  // Default is to return true
  return true
}

export function routeHeadways(
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache
): RouteHeadwaySummary {
  const result = newRouteHeadwaySummary()
  if (!sdCache) {
    return result
  }  
  for (const d of selectedDateRange) {
    let dir = 0
    let stopId: number = 0
    let stopDepartures: StopTime[] = []
    const dir0 = sdCache.getRouteDate(route.id, 0, format(d, 'yyyy-MM-dd'))
    const dir1 = sdCache.getRouteDate(route.id, 1, format(d, 'yyyy-MM-dd'))
    for (const [depStopId, deps] of dir0.entries()) {
      if (deps.length > stopDepartures.length) {
        stopId = depStopId
        stopDepartures = deps
      }
    }
    for (const [depStopId, deps] of dir1.entries()) {
      if (deps.length > stopDepartures.length) {
        dir = 1
        stopId = depStopId
        stopDepartures = deps
      }
    }
    console.log('route:', route.id, 'date:', d, 'stopId:', stopId, 'dir:', dir, 'stopDepartures:', stopDepartures.length) 
  }
  return result
}

export function routeToRouteCsv(route: Route): RouteCsv {
  return {
    row: 0,
    marked: route.marked,
    average_frequency: route.average_frequency,
    fastest_frequency: route.fastest_frequency,
    slowest_frequency: route.slowest_frequency,
    agency_name: route.agency_name,
    mode: route.mode,
    route_name: route.route_name,
    // GTFS properties
    route_id: route.route_id,
    route_long_name: route.route_long_name,
    route_short_name: route.route_short_name,
    route_type: route.route_type,
    route_color: route.route_color,
    route_text_color: route.route_text_color,
    route_url: route.route_url,
    route_desc: route.route_desc,
    route_sort_order: route.route_sort_order,
    continuous_drop_off: route.continuous_drop_off,
    continuous_pickup: route.continuous_pickup,
  }
}

export function newRouteHeadwaySummary(): RouteHeadwaySummary {
  return {
    total: newRouteHeadwayDirections(),
    monday: newRouteHeadwayDirections()
  }
}

function newRouteHeadwayDirections() {
  return {
    dir0: {stop_id: 0, direction: 0, headways_seconds: []},
    dir1: {stop_id: 0, direction: 1, headways_seconds: []}
  }
}
