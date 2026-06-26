import { gql } from 'graphql-tag'
import type { CensusValues, GraphQLClient } from '~~/src/core'
import { parseAcsValues } from './census'

// #315 — per-entity buffer ∩ census intersections + inline ACS values.
// Layer is a parameter; apportionment math is in `src/core/census-buffer.ts`.

export type BufferEntityKind = 'stops' | 'routes' | 'agencies'

export interface BufferGeographyIntersection {
  geoid: string
  layer: string
  geometryArea: number
  intersectionArea: number
  values: CensusValues
  // Gated by `@include` so the main pipeline doesn't pay for polygons.
  geometry?: GeoJSON.MultiPolygon
  intersectionGeometry?: GeoJSON.Geometry
}

export interface FetchBufferConfig {
  client: GraphQLClient
  ids: number[]
  geoDataset: string
  tableDataset: string
  tableNames: string[]
  layer: string
  radius: number
  // Opt-in (default false) — used by the map view.
  includeGeometry?: boolean
}

export type EntityBufferResult = [id: number, geographies: BufferGeographyIntersection[]]

export interface BufferEntityResponse {
  id: number
  census_geographies: BufferGeographyResponse[]
}

export interface BufferGeographyResponse {
  geoid: string
  layer_name: string
  geometry_area: number | null
  intersection_area: number | null
  geometry?: GeoJSON.MultiPolygon
  intersection_geometry?: GeoJSON.Geometry
  values: { dataset_name: string, values: Record<string, number> }[]
}

// Shape of the top-level Apollo result for any one of the three buffer queries.
export type BufferQueryResponse = Partial<Record<BufferEntityKind, BufferEntityResponse[]>>

// Parse a raw buffer-query response into `BufferGeographyIntersection[]` for a
// single entity (`ids: [id]` case). Used by callers that bypass
// `fetchEntityBufferGeographies` because they hold an Apollo client.
export function parseBufferEntityResult (
  data: BufferQueryResponse | null | undefined,
  kind: BufferEntityKind,
  tableDataset: string,
): BufferGeographyIntersection[] {
  const ent = data?.[kind]?.[0]
  const out: BufferGeographyIntersection[] = []
  for (const g of ent?.census_geographies ?? []) {
    const row = parseGeographyRow(g, tableDataset)
    if (row) { out.push(row) }
  }
  return out
}

// Three queries instead of one templated — `gql` strings stay readable as
// standalone GraphQL documents.
export const stopsBufferQuery = gql`
  query (
    $ids: [Int!]!,
    $dataset: String,
    $layer: String!,
    $radius: Float!,
    $tableDataset: String,
    $tableNames: [String!]!,
    $includeGeometry: Boolean = false
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
        geometry @include(if: $includeGeometry)
        intersection_geometry @include(if: $includeGeometry)
        values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
          dataset_name
          values
        }
      }
    }
  }
`

export const routesBufferQuery = gql`
  query (
    $ids: [Int!]!,
    $dataset: String,
    $layer: String!,
    $radius: Float!,
    $tableDataset: String,
    $tableNames: [String!]!,
    $includeGeometry: Boolean = false
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
        geometry @include(if: $includeGeometry)
        intersection_geometry @include(if: $includeGeometry)
        values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
          dataset_name
          values
        }
      }
    }
  }
`

export const agenciesBufferQuery = gql`
  query (
    $ids: [Int!]!,
    $dataset: String,
    $layer: String!,
    $radius: Float!,
    $tableDataset: String,
    $tableNames: [String!]!,
    $includeGeometry: Boolean = false
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
        geometry @include(if: $includeGeometry)
        intersection_geometry @include(if: $includeGeometry)
        values(table_names: $tableNames, dataset: $tableDataset, limit: 1000) {
          dataset_name
          values
        }
      }
    }
  }
`

export const BUFFER_QUERY_BY_KIND = {
  stops: stopsBufferQuery,
  routes: routesBufferQuery,
  agencies: agenciesBufferQuery,
} as const

export function parseGeographyRow (g: BufferGeographyResponse, tableDataset: string): BufferGeographyIntersection | null {
  const geometryArea = g.geometry_area ?? 0
  if (geometryArea <= 0) {
    return null
  }
  const values = parseAcsValues(g.values, tableDataset)
  return {
    geoid: g.geoid,
    layer: g.layer_name,
    geometryArea,
    intersectionArea: g.intersection_area ?? 0,
    values,
    geometry: g.geometry,
    intersectionGeometry: g.intersection_geometry,
  }
}

export async function fetchEntityBufferGeographies (
  kind: BufferEntityKind,
  config: FetchBufferConfig,
): Promise<EntityBufferResult[]> {
  const response = await config.client.query<Record<BufferEntityKind, BufferEntityResponse[]>>(
    BUFFER_QUERY_BY_KIND[kind],
    {
      ids: config.ids,
      dataset: config.geoDataset,
      layer: config.layer,
      radius: config.radius,
      tableDataset: config.tableDataset,
      tableNames: config.tableNames,
      includeGeometry: config.includeGeometry ?? false,
    },
  )
  return (response.data?.[kind] || []).map((ent): EntityBufferResult => {
    const geographies: BufferGeographyIntersection[] = []
    for (const g of ent.census_geographies || []) {
      const parsed = parseGeographyRow(g, config.tableDataset)
      if (parsed) {
        geographies.push(parsed)
      }
    }
    return [ent.id, geographies]
  })
}
