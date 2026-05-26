import { gql } from 'graphql-tag'
import type { GraphQLClient, CensusValues } from '~~/src/core'

// Issue #315: per-stop "stop statistical radius" — a circular buffer around
// each stop, intersected with census geographies (tracts for now), used to
// apportion demographic values. This module owns the GraphQL queries and
// fetch helpers; the apportionment math lives in `src/core/census-buffer.ts`.
//
// We request ACS `values(...)` inline on each CensusGeography so callers can
// apportion without a second round-trip to Pass A. ACS jam values (negative
// sentinels) are filtered out — same policy as the bbox-clipped Pass A.

const ACS_JAM_VALUES = new Set<number>([-666666666, -888888888, -999999999])

export interface TractIntersection {
  /** TIGER GEOID, e.g. `06075020800` for a census tract. */
  geoid: string
  /** Census layer the row belongs to (mirrors the request `layer`). */
  layer: string
  /** Full geography area in m². 0 means the row is degenerate; skip. */
  geometryArea: number
  /** Intersection (geography ∩ buffer) in m². */
  intersectionArea: number
  /** Raw ACS values keyed by `<table>_<col>`, jam values dropped. */
  values: CensusValues
}

export interface StopBufferResult {
  stopId: number
  tracts: TractIntersection[]
}

export interface RouteBufferResult {
  routeId: number
  tracts: TractIntersection[]
}

export interface AgencyBufferResult {
  agencyId: number
  tracts: TractIntersection[]
}

// Per-stop buffer + tract values. The server unions the requested radius
// around the stop point and returns each intersecting geography along with
// its ACS values for the requested tables.
export const stopBufferQuery = gql`
query (
  $ids: [Int!]!,
  $dataset: String,
  $layer: String!,
  $radius: Float!,
  $tableDataset: String,
  $tableNames: [String!]!
) {
  stops(ids: $ids) {
    id
    census_geographies(
      limit: 10000,
      where: {dataset: $dataset, layer: $layer, radius: $radius}
    ) {
      geoid
      layer_name
      geometry_area
      intersection_area
      values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
        dataset_name
        values
      }
    }
  }
}
`

// Identical shape on Route / Agency — the server unions the stop_buffer over
// every stop the entity touches. Known limitation (#315 plan): the union is
// over the entity's full stop set, not the bbox-clipped subset.
export const routeBufferQuery = gql`
query (
  $ids: [Int!]!,
  $dataset: String,
  $layer: String!,
  $radius: Float!,
  $tableDataset: String,
  $tableNames: [String!]!
) {
  routes(ids: $ids) {
    id
    census_geographies(
      limit: 10000,
      where: {dataset: $dataset, layer: $layer, radius: $radius}
    ) {
      geoid
      layer_name
      geometry_area
      intersection_area
      values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
        dataset_name
        values
      }
    }
  }
}
`

export const agencyBufferQuery = gql`
query (
  $ids: [Int!]!,
  $dataset: String,
  $layer: String!,
  $radius: Float!,
  $tableDataset: String,
  $tableNames: [String!]!
) {
  agencies(ids: $ids) {
    id
    census_geographies(
      limit: 10000,
      where: {dataset: $dataset, layer: $layer, radius: $radius}
    ) {
      geoid
      layer_name
      geometry_area
      intersection_area
      values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
        dataset_name
        values
      }
    }
  }
}
`

interface BufferEntityResponse {
  id: number
  census_geographies: BufferGeographyResponse[]
}

interface BufferGeographyResponse {
  geoid: string
  layer_name: string
  geometry_area: number | null
  intersection_area: number | null
  values: { dataset_name: string, values: Record<string, number> }[]
}

function parseTractRow (g: BufferGeographyResponse, tableDataset: string): TractIntersection | null {
  const geometryArea = g.geometry_area ?? 0
  if (geometryArea <= 0) {
    return null
  }
  const intersectionArea = g.intersection_area ?? 0
  const values: CensusValues = {}
  for (const row of g.values || []) {
    if (row.dataset_name !== tableDataset) {
      continue
    }
    for (const [k, v] of Object.entries(row.values || {})) {
      if (typeof v === 'number' && Number.isFinite(v) && !ACS_JAM_VALUES.has(v)) {
        values[k] = v
      }
    }
  }
  return {
    geoid: g.geoid,
    layer: g.layer_name,
    geometryArea,
    intersectionArea,
    values,
  }
}

export interface FetchBufferConfig {
  client: GraphQLClient
  ids: number[]
  geoDataset: string
  tableDataset: string
  tableNames: string[]
  layer: string
  radius: number
}

export async function fetchStopBufferTracts (config: FetchBufferConfig): Promise<StopBufferResult[]> {
  const response = await config.client.query<{ stops: BufferEntityResponse[] }>(stopBufferQuery, {
    ids: config.ids,
    dataset: config.geoDataset,
    layer: config.layer,
    radius: config.radius,
    tableDataset: config.tableDataset,
    tableNames: config.tableNames,
  })
  const out: StopBufferResult[] = []
  for (const stop of response.data?.stops || []) {
    const tracts: TractIntersection[] = []
    for (const g of stop.census_geographies || []) {
      const t = parseTractRow(g, config.tableDataset)
      if (t) {
        tracts.push(t)
      }
    }
    out.push({ stopId: stop.id, tracts })
  }
  return out
}

export async function fetchRouteBufferTracts (config: FetchBufferConfig): Promise<RouteBufferResult[]> {
  const response = await config.client.query<{ routes: BufferEntityResponse[] }>(routeBufferQuery, {
    ids: config.ids,
    dataset: config.geoDataset,
    layer: config.layer,
    radius: config.radius,
    tableDataset: config.tableDataset,
    tableNames: config.tableNames,
  })
  const out: RouteBufferResult[] = []
  for (const route of response.data?.routes || []) {
    const tracts: TractIntersection[] = []
    for (const g of route.census_geographies || []) {
      const t = parseTractRow(g, config.tableDataset)
      if (t) {
        tracts.push(t)
      }
    }
    out.push({ routeId: route.id, tracts })
  }
  return out
}

export async function fetchAgencyBufferTracts (config: FetchBufferConfig): Promise<AgencyBufferResult[]> {
  const response = await config.client.query<{ agencies: BufferEntityResponse[] }>(agencyBufferQuery, {
    ids: config.ids,
    dataset: config.geoDataset,
    layer: config.layer,
    radius: config.radius,
    tableDataset: config.tableDataset,
    tableNames: config.tableNames,
  })
  const out: AgencyBufferResult[] = []
  for (const agency of response.data?.agencies || []) {
    const tracts: TractIntersection[] = []
    for (const g of agency.census_geographies || []) {
      const t = parseTractRow(g, config.tableDataset)
      if (t) {
        tracts.push(t)
      }
    }
    out.push({ agencyId: agency.id, tracts })
  }
  return out
}
