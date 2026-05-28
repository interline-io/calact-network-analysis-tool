import { gql } from 'graphql-tag'
import { ACS_JAM_VALUES, type CensusValues, type GraphQLClient } from '~~/src/core'

// Per-stop / per-route / per-agency buffer geography intersections + inline
// ACS values (issue #315). The census layer is a parameter; today's callers
// use `tract`, but nothing here assumes it. Apportionment math lives in
// `src/core/census-buffer.ts`.

export type BufferEntityKind = 'stops' | 'routes' | 'agencies'

export interface BufferGeographyIntersection {
  geoid: string
  layer: string
  geometryArea: number
  intersectionArea: number
  values: CensusValues
  // Populated only when the fetch was made with `includeGeometry: true` —
  // gated by an `@include` directive so the main scenario pipeline doesn't
  // pay for polygon payloads it'll never render.
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
  // Default false. When true, the GraphQL response includes the tract's
  // full geometry and the intersection geometry with the stop buffer —
  // used by the buffer-details modal's map view.
  includeGeometry?: boolean
}

export type EntityBufferResult = [id: number, geographies: BufferGeographyIntersection[]]

interface BufferEntityResponse {
  id: number
  census_geographies: BufferGeographyResponse[]
}

interface BufferGeographyResponse {
  geoid: string
  layer_name: string
  geometry_area: number | null
  intersection_area: number | null
  geometry?: GeoJSON.MultiPolygon
  intersection_geometry?: GeoJSON.Geometry
  values: { dataset_name: string, values: Record<string, number> }[]
}

// One const gql per entity kind. We accept the duplication rather than
// interpolating `${kind}` into a single template — gql queries must read as
// if they lived in a .gql file.
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
