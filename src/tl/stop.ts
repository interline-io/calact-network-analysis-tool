import { gql } from 'graphql-tag'
import {
  routeTypeNames,
  type CensusGeographyData,
  deriveCensusRow,
  apportionBuffer,
  geographiesForAggregationRow,
  HIERARCHICAL_TIGER_LAYERS,
} from '~~/src/core'
import type { BufferGeographyIntersection } from './stop-buffer'
import type { RouteGql } from './route'

//////////
// Stops
//////////

export const stopQuery = gql`
query Stops($limit: Int, $after: Int, $where: StopFilter) {
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
    # Without an explicit limit the backend returns 100. The departures phase
    # fetches by route, so a route missing here loses its departures across the
    # whole scenario, not just this stop's metadata. 1000 is the server maximum.
    # Ids only; names and route_type join from the routes phase.
    route_stops(limit: 1000) {
      route_id
      agency_id
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
  // The stop's census geographies at the aggregation layer, joined on from the
  // stop-census phase. Absent on a run that fetched no census.
  census_geographies?: StopCensusGeography[]
}

// One census geography a stop falls inside, at a single layer.
export interface StopCensusGeography {
  id: number
  name: string
  geoid: string
  layer_name: string
}

// The aggregation layer's geography for each of a set of stops. Fetched apart
// from stop discovery: it is not needed to reach routes or departures, and
// riding along on that query made every page wait for it.
export const stopCensusQuery = gql`
query StopCensus($ids: [Int!], $limit: Int, $dataset: String, $layer: String) {
  stops(ids: $ids, limit: $limit) {
    id
    # A global cap across the dataloader's batch of stops, not a per-stop one,
    # so it is set well above one layer's worth of rows per stop.
    census_geographies(limit: 10000, where:{dataset: $dataset, layer: $layer}) {
      id
      geoid
      layer_name
      name
    }
  }
}`

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
    route_id: number
    agency_id: number
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
  // Set only when the aggregation layer is hierarchical AND buffer data is provided.
  pct_buffer_coverage?: number | null
  [key: string]: string | number | null | undefined
}

export type Stop = StopGql & StopDerived

///////////////////////////
// Stop csv
///////////////////////////

// Demographic columns come from one of two sources, picked by `useBuffer`:
//   - Pass F (#315): when buffer geographies are provided AND the layer is in
//     HIERARCHICAL_TIGER_LAYERS. FIPS-prefix rollup + apportionBuffer().
//   - Pass A (bbox-clipped) otherwise — non-hierarchical layers can't roll
//     up by string match (needs server-side geometric containment, #370).
interface StopGeoAggregateRow {
  geoid: string
  layer_name: string
  name: string
  visits_count?: number
  stops_count: Set<number>
  routes_count: Set<number>
  routes_modes: Set<number>
  agencies_count: Set<number>
}

function seedAggregateRow (geoid: string, layerName: string, name: string): StopGeoAggregateRow {
  return {
    geoid,
    layer_name: layerName,
    name,
    visits_count: 0,
    stops_count: new Set<number>(),
    routes_count: new Set<number>(),
    routes_modes: new Set<number>(),
    agencies_count: new Set<number>(),
  }
}

export function stopGeoAggregateCsv (
  stops: Stop[],
  aggregationKey: string,
  routeLookup: Map<number, RouteGql>,
  censusGeographies?: Map<string, CensusGeographyData>,
  options?: { onlyWithStops?: boolean, aggregationBufferGeographies?: BufferGeographyIntersection[] },
): StopGeoAggregateCsv[] {
  const bufferGeographies = options?.aggregationBufferGeographies
  const useBuffer = !!(bufferGeographies && bufferGeographies.length > 0
    && HIERARCHICAL_TIGER_LAYERS.has(aggregationKey))
  const stopAgg = new Map<string, StopGeoAggregateRow>()

  // Seed every geography so stop-less tracts still produce a row. Skipped
  // when the caller only wants stop-touched rows.
  if (!options?.onlyWithStops) {
    for (const [geoid, geo] of censusGeographies || []) {
      stopAgg.set(geoid, seedAggregateRow(geoid, aggregationKey, geo.name))
    }
    // A stop buffer reaches geographies the query area doesn't cover, and
    // their demographics belong in this table. Seeded from the buffer
    // footprint itself, since the query area by definition doesn't include
    // them. Only at the aggregation layer — finer ones roll up by FIPS
    // prefix into a row that already exists.
    if (useBuffer) {
      for (const geo of bufferGeographies!) {
        if (geo.layer === aggregationKey && !stopAgg.has(geo.geoid)) {
          stopAgg.set(geo.geoid, seedAggregateRow(geo.geoid, aggregationKey, geo.name || ''))
        }
      }
    }
  }

  for (const stop of stops) {
    const geogs = (stop.census_geographies || []).filter(g => g.layer_name === aggregationKey)
    for (const geog of geogs) {
      const a = stopAgg.get(geog.geoid) || seedAggregateRow(geog.geoid, geog.layer_name, geog.name)
      a.stops_count.add(stop.id)
      a.visits_count = (a.visits_count || 0) + (stop.visits?.total?.visit_count || 0)
      for (const rstop of stop.route_stops) {
        a.routes_count.add(rstop.route_id)
        a.agencies_count.add(rstop.agency_id)
        const route = routeLookup.get(rstop.route_id)
        if (route) {
          a.routes_modes.add(route.route_type)
        }
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
    if (useBuffer) {
      const matched = geographiesForAggregationRow(a.geoid, bufferGeographies!)
      const result = apportionBuffer(matched)
      Object.assign(row, result.values)
      row.pct_buffer_coverage = result.pctCoverage
    } else if (censusGeographies) {
      const geo = censusGeographies.get(a.geoid)
      if (geo) {
        Object.assign(row, deriveCensusRow(geo.values))
      }
    }
    return row
  })
  return [...result]
}

export function stopToStopCsv (stop: Stop, routeLookup: Map<number, RouteGql>, bufferGeographies?: BufferGeographyIntersection[]): StopCsv {
  const routeStops = stop.route_stops || []
  const modes = new Set()
  const agencies = new Set()
  for (const rstop of routeStops) {
    agencies.add(rstop.agency_id)
    const route = routeLookup.get(rstop.route_id)
    const mode = route && routeTypeNames.get(route.route_type)
    if (mode) {
      modes.add(mode)
    }
  }
  const row: StopCsv = {
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
  return bufferGeographies?.length
    ? { ...row, ...apportionBuffer(bufferGeographies).values }
    : row
}
