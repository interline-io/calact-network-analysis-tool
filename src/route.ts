import { gql } from 'graphql-tag'
import { format } from 'date-fns'
import type { MultiLineString } from 'geojson'
import type { StopTime } from '~/src/departure'
import type { StopDepartureCache } from '~/src/departure-cache'
import { parseHMS } from '~/src/datetime'

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
  geometry: MultiLineString
  agency: {
    id: number
    agency_id: string
    agency_name: string
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
  average_frequency: number | null
  fastest_frequency: number | null
  slowest_frequency: number | null
}

export type RouteHeadwayCount = {
  stop_id: number
  headways_seconds: number[]
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
  average_frequency: number | null
  fastest_frequency: number | null
  slowest_frequency: number | null
}

export type Route = RouteGql & RouteDerived

////////////////////
// Route filtering
////////////////////

export function routeSetDerived (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  sdCache: StopDepartureCache | null,
) {
  // Set derived properties
  if (sdCache) {
    const headwayResult = routeHeadways(
      route,
      selectedDateRange,
      selectedStartTime,
      selectedEndTime,
      sdCache,
    )
    const hwTotal = headwayResult.total
    let hw = hwTotal.dir0
    if (hwTotal.dir1.headways_seconds.length > hwTotal.dir0.headways_seconds.length) {
      hw = hwTotal.dir1
    }
    if (hw.headways_seconds.length > 0) {
      route.average_frequency = (hw.headways_seconds.reduce((a, b) => a + b) / hw.headways_seconds.length)
      route.fastest_frequency = hw.headways_seconds[0]
      route.slowest_frequency = hw.headways_seconds[hw.headways_seconds.length - 1]
    } else {
      route.average_frequency = null
      route.fastest_frequency = null
      route.slowest_frequency = null
    }
  }
  // Mark after setting frequency values
  route.marked = routeMarked(
    route,
    selectedRouteTypes,
    selectedAgencies,
    frequencyUnder,
    frequencyOver,
    sdCache,
  )
}

// Filter routes
function routeMarked (
  route: Route,
  selectedRouteTypes: number[],
  selectedAgencies: string[],
  frequencyUnder: number,
  frequencyOver: number,
  sdCache: StopDepartureCache | null,
): boolean {
  // Check route types
  if (selectedRouteTypes.length > 0) {
    if (!selectedRouteTypes.includes(route.route_type)) {
      return false
    }
  }

  // Check agencies
  if (selectedAgencies.length > 0) {
    if (!selectedAgencies.includes(route.agency.agency_name)) {
      return false
    }
  }

  if (sdCache && frequencyOver >= 0) {
    if (!route.average_frequency || route.average_frequency < frequencyOver * 60) {
      return false
    }
  }

  if (sdCache && frequencyUnder >= 0) {
    if (!route.average_frequency || route.average_frequency > frequencyUnder * 60) {
      return false
    }
  }

  // Default is to return true
  return true
}

export function routeHeadways (
  route: Route,
  selectedDateRange: Date[],
  selectedStartTime: string,
  selectedEndTime: string,
  sdCache: StopDepartureCache | null
): RouteHeadwaySummary {
  const result = newRouteHeadwaySummary()
  if (!sdCache) {
    return result
  }
  const startTime = parseHMS(selectedStartTime)
  const endTime = parseHMS(selectedEndTime)
  for (const dir of [0, 1]) {
    for (const d of selectedDateRange) {
      // Get the stop with the most departures
      let stopId: number = 0
      let stopDepartures: StopTime[] = []
      const dateStopDeps = sdCache.getRouteDate(route.id, dir, format(d, 'yyyy-MM-dd'))
      for (const [depStopId, deps] of dateStopDeps.entries()) {
        if (deps.length > stopDepartures.length) {
          stopId = depStopId
          stopDepartures = deps
        }
      }

      // Convert HH:MM:SS to seconds and calculate headways
      const stSecs = stopDepartures
        .map((st) => { return parseHMS(st.departure_time) })
        .filter((depTime) => { return depTime >= startTime && depTime <= endTime })
      stSecs.sort((a, b) => a - b)

      const headways: number[] = []
      for (let i = 0; i < stSecs.length - 1; i++) {
        headways.push(stSecs[i + 1] - stSecs[i])
      }
      headways.sort((a, b) => a - b)

      // Add to result
      const resultDir = dir ? result.total.dir1 : result.total.dir0
      resultDir.stop_id = stopId
      resultDir.headways_seconds.push(...headways)

      let resultDay: RouteHeadwayDirections | null = null
      switch (d.getDay()) {
        case 0:
          resultDay = result.sunday
          break
        case 1:
          resultDay = result.monday
          break
        case 2:
          resultDay = result.tuesday
          break
        case 3:
          resultDay = result.wednesday
          break
        case 4:
          resultDay = result.thursday
          break
        case 5:
          resultDay = result.friday
          break
        case 6:
          resultDay = result.saturday
          break
      }
      if (resultDay) {
        const dayDir = dir ? resultDay.dir1 : resultDay.dir0
        dayDir.stop_id = stopId
        dayDir.headways_seconds.push(...headways)
      }
    }
  }
  return result
}

export function newRouteHeadwaySummary (): RouteHeadwaySummary {
  return {
    total: newRouteHeadwayDirections(),
    sunday: newRouteHeadwayDirections(),
    monday: newRouteHeadwayDirections(),
    tuesday: newRouteHeadwayDirections(),
    wednesday: newRouteHeadwayDirections(),
    thursday: newRouteHeadwayDirections(),
    friday: newRouteHeadwayDirections(),
    saturday: newRouteHeadwayDirections(),
  }
}

function newRouteHeadwayDirections () {
  return {
    dir0: { stop_id: 0, headways_seconds: [] },
    dir1: { stop_id: 0, headways_seconds: [] }
  }
}

////////////////////
// Route csv
////////////////////

export function routeToRouteCsv (route: Route): RouteCsv {
  return {
    id: route.id,
    marked: route.marked,
    average_frequency: route.average_frequency ? Math.round(route.average_frequency) : null,
    fastest_frequency: route.fastest_frequency ? Math.round(route.fastest_frequency) : null,
    slowest_frequency: route.slowest_frequency ? Math.round(route.slowest_frequency) : null,
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
