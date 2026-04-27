import { gql } from 'graphql-tag'
import { routeTypeNames, type CensusGeographyData, deriveCensusRow } from '~~/src/core'

//////////
// Stops
//////////

export const stopQuery = gql`
query ($limit: Int, $after: Int, $where: StopFilter, $dataset_name: String) {
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
    # Fetches all layers for the dataset (no layer filter) so aggregation level can change without re-querying.
    # limit:1000 is high enough for typical queries; results silently truncate if exceeded.
    census_geographies(limit: 1000, where:{dataset: $dataset_name}) {
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
  visits?: StopVisitSummary
}

export interface StopVisitCounts {
  date_count: number
  visit_count: number
  visit_average?: number
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
  }
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
  stop_lon?: number
  stop_lat?: number
  routes_modes: string
  routes_count: number
  agencies_count: number
  marked: boolean
  visit_count_total?: number
  visit_count_monday_total?: number
  visit_count_tuesday_total?: number
  visit_count_wednesday_total?: number
  visit_count_thursday_total?: number
  visit_count_friday_total?: number
  visit_count_saturday_total?: number
  visit_count_sunday_total?: number
}

interface StopGeoAggregateCsv {
  geoid: string
  layer_name: string
  name: string
  routes_count: number
  routes_modes: string
  stops_count: number
  agencies_count: number
  visit_count_total?: number
  // Derived demographic columns merged in when censusValues is provided.
  // Keyed by CensusColumnDef.id (e.g. total_population, pct_people_of_color).
  [key: string]: string | number | null | undefined
}

export type Stop = StopGql & StopDerived

///////////////////////////
// Stop csv
///////////////////////////

export function stopGeoAggregateCsv (
  stops: Stop[],
  aggregationKey: string,
  censusGeographies?: Map<string, CensusGeographyData>,
  options?: { onlyWithStops?: boolean },
): StopGeoAggregateCsv[] {
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

  // Seed every geography so stop-less tracts still produce a row. Skipped
  // when the caller only wants stop-touched rows.
  if (censusGeographies && !options?.onlyWithStops) {
    for (const [geoid, geo] of censusGeographies) {
      stopAgg.set(geoid, {
        geoid,
        layer_name: aggregationKey,
        name: geo.name,
        visits_count: 0,
        stops_count: new Set<number>(),
        routes_count: new Set<number>(),
        routes_modes: new Set<number>(),
        agencies_count: new Set<number>(),
      })
    }
  }

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
  const result = [...stopAgg.values()].map((a): StopGeoAggregateCsv => {
    const rmodes = [...a.routes_modes.values()].map((r): string => routeTypeNames.get(r) || 'Unknown')
    const row: StopGeoAggregateCsv = {
      geoid: a.geoid,
      layer_name: a.layer_name,
      name: a.name,
      stops_count: a.stops_count.size,
      routes_count: a.routes_count.size,
      routes_modes: [...rmodes].join(', '),
      agencies_count: a.agencies_count.size,
      visit_count_total: a.visits_count || 0,
    }
    if (censusGeographies) {
      const geo = censusGeographies.get(a.geoid)
      if (geo) {
        Object.assign(row, deriveCensusRow(geo.values))
      }
    }
    return row
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
    const mode = routeTypeNames.get(rtype)
    if (mode) {
      modes.add(mode)
    }
  }
  return {
    // GTFS properties
    id: stop.id,
    stop_lon: stop.geometry.coordinates[0] || undefined,
    stop_lat: stop.geometry.coordinates[1] || undefined,
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
    visit_count_total: stop.visits?.total?.visit_count,
    visit_count_monday_total: stop.visits?.monday?.visit_count,
    visit_count_tuesday_total: stop.visits?.tuesday?.visit_count,
    visit_count_wednesday_total: stop.visits?.wednesday?.visit_count,
    visit_count_thursday_total: stop.visits?.thursday?.visit_count,
    visit_count_friday_total: stop.visits?.friday?.visit_count,
    visit_count_saturday_total: stop.visits?.saturday?.visit_count,
    visit_count_sunday_total: stop.visits?.sunday?.visit_count,
  }
}
