import { gql } from 'graphql-tag'

//////////
// Routes
//////////

export const routeQuery = gql`
query ($ids: [Int!], $where: RouteFilter) {
  routes(limit: 1000, ids: $ids, where: $where) {
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
    feed_version {
      sha1
      feed {
        onestop_id
      }
    }
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
  feed_version: {
    sha1: string
    feed: {
      onestop_id: string
    }
  }
  __typename?: string // GraphQL compatibility
} & RouteGtfs

export interface RouteDerived {
  [key: string]: any
  marked: boolean
  route_name: string
  agency_name: string
  route_mode: string
  headways: RouteHeadwaySummary
  average_frequency?: number
  fastest_frequency?: number
  slowest_frequency?: number
}

export type RouteHeadwayCount = {
  stop_id: number
  departures: number[]
}

export type RouteHeadwayDirections = {
  dir0: RouteHeadwayCount
  dir1: RouteHeadwayCount
}

export type RouteHeadwaySummary = {
  total: RouteHeadwayDirections
  sunday: RouteHeadwayDirections
  monday: RouteHeadwayDirections
  tuesday: RouteHeadwayDirections
  wednesday: RouteHeadwayDirections
  thursday: RouteHeadwayDirections
  friday: RouteHeadwayDirections
  saturday: RouteHeadwayDirections
}

export type RouteCsv = RouteGtfs & {
  id: number
  marked: boolean
  route_name: string
  agency_name: string
  route_mode: string
  average_frequency?: number
  fastest_frequency?: number
  slowest_frequency?: number
}

export type Route = RouteGql & RouteDerived

////////////////////
// Route csv
////////////////////

export function routeToRouteCsv (route: Route): RouteCsv {
  return {
    id: route.id,
    marked: route.marked,
    average_frequency: route.average_frequency ? Math.round(route.average_frequency) : undefined,
    fastest_frequency: route.fastest_frequency ? Math.round(route.fastest_frequency) : undefined,
    slowest_frequency: route.slowest_frequency ? Math.round(route.slowest_frequency) : undefined,
    agency_name: route.agency_name,
    route_mode: route.route_mode,
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
