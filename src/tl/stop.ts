import { gql } from 'graphql-tag'
import { routeTypes } from '~/src/core'

//////////
// Stops
//////////

export const stopQuery = gql`
query ($limit: Int, $after: Int, $where: StopFilter, $dataset_name: String, $layer_name: String) {
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
    parent {
      stop_id
    }
    feed_version {
      sha1
      feed {
        onestop_id
      }
    }
    census_geographies(limit: 100, where:{dataset: $dataset_name, layer: $layer_name, radius:0.0}) {
      id
      geoid
      layer_name
      name
    }    
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
  visits: StopVisitSummary | null
}

export interface StopVisitCounts {
  date_count: number
  visit_count: number
  visit_average: number | null
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
  __typename?: string // GraphQL compatibility
  id: number
  geometry: GeoJSON.Point
  census_geographies: [{
    id: number
    name: string
    geoid: string
    layer_name: string
  }]
  parent?: {
    stop_id: string
  } | null
  feed_version: {
    sha1: string
    feed: {
      onestop_id: string
    }
  }
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
  id: number
  routes_modes: string
  routes_count: number
  agencies_count: number
  marked: boolean
  visit_count_daily_average: number | null
  visit_count_monday_average: number | null
  visit_count_tuesday_average: number | null
  visit_count_wednesday_average: number | null
  visit_count_thursday_average: number | null
  visit_count_friday_average: number | null
  visit_count_saturday_average: number | null
  visit_count_sunday_average: number | null
}

interface StopGeoAggregateCsv {
  geoid: string
  layer_name: string
  name: string
  routes_count: number
  routes_modes: string
  stops_count: number
  agencies_count: number
  visit_count_daily_average: number | null
}

export type Stop = StopGql & StopDerived

///////////////////////////
// Stop csv
///////////////////////////

export function stopGeoAggregateCsv (stops: Stop[], aggregationKey: string): StopGeoAggregateCsv[] {
  const stopAgg = new Map<string, {
    geoid: string
    layer_name: string
    name: string
    visits_count?: number
    stops_count: Set<number>
    routes_count: Set<number>
    routes_modes: Set<number>
    agencies_count: Set<number>
  }>()

  const dateCount = stops[0]?.visits?.total?.date_count || 0
  for (const stop of stops) {
    const geogs = (stop.census_geographies || []).filter(g => g.layer_name === aggregationKey)
    for (const geog of geogs) {
      const a = stopAgg.get(geog.geoid) || {
        geoid: geog.geoid,
        layer_name: geog.layer_name,
        name: geog.name,
        visits_count: 0,
        stops_count: new Set<number>(),
        routes_count: new Set<number>(),
        routes_modes: new Set<number>(),
        agencies_count: new Set<number>(),
      }
      a.stops_count.add(stop.id)
      a.visits_count = (a.visits_count || 0) + (stop.visits?.total?.visit_count || 0)
      for (const rstop of stop.route_stops) {
        a.agencies_count.add(rstop.route.agency.id)
        a.routes_count.add(rstop.route.id)
        a.routes_modes.add(rstop.route.route_type)
      }
      stopAgg.set(geog.geoid, a)
    }
  }
  const result = stopAgg.values().map((a): StopGeoAggregateCsv => {
    const rmodes = a.routes_modes.values().map((r): string => routeTypes.get(r) || 'Unknown')
    return {
      geoid: a.geoid,
      layer_name: a.layer_name,
      name: a.name,
      stops_count: a.stops_count.size,
      routes_count: a.routes_count.size,
      routes_modes: [...rmodes].join(', '),
      agencies_count: a.agencies_count.size,
      visit_count_daily_average: roundOr(checkDiv(a.visits_count || 0, dateCount)),
    }
  })
  return [...result]
}

export function stopToStopCsv (stop: Stop): StopCsv {
  const routeStops = stop.route_stops || []
  const modes = new Set()
  const agencies = new Set()
  for (const rstop of routeStops) {
    agencies.add(rstop.route.agency.id)
    const rtype = rstop.route.route_type
    const mode = routeTypes.get(rtype)
    if (mode) {
      modes.add(mode)
    }
  }
  return {
    // GTFS properties
    id: stop.id,
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
    routes_count: stop.route_stops.length,
    routes_modes: Array.from(modes).join(','),
    agencies_count: agencies.size,
    visit_count_daily_average: roundOr(stop.visits?.total?.visit_average),
    visit_count_monday_average: roundOr(stop.visits?.monday?.visit_average),
    visit_count_tuesday_average: roundOr(stop.visits?.tuesday?.visit_average),
    visit_count_wednesday_average: roundOr(stop.visits?.wednesday?.visit_average),
    visit_count_thursday_average: roundOr(stop.visits?.thursday?.visit_average),
    visit_count_friday_average: roundOr(stop.visits?.friday?.visit_average),
    visit_count_saturday_average: roundOr(stop.visits?.saturday?.visit_average),
    visit_count_sunday_average: roundOr(stop.visits?.sunday?.visit_average),
  }
}

function roundOr (value: number | null | undefined): number | null {
  const digits = 2
  if (value == null) {
    return null
  }
  const factor = Math.pow(10, digits)
  return Math.round(value * factor) / factor
}

function checkDiv (a: number, b: number): number {
  return b === 0 ? 0 : a / b
}
