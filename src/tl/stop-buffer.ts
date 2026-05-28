import { gql } from 'graphql-tag'
import { ACS_JAM_VALUES, type CensusValues, type GraphQLClient } from '~~/src/core'

// Per-stop / per-route / per-agency buffer tract intersections + inline ACS
// values (issue #315). Apportionment math lives in `src/core/census-buffer.ts`.

export type BufferEntityKind = 'stops' | 'routes' | 'agencies'

export interface TractIntersection {
  geoid: string
  layer: string
  geometryArea: number
  intersectionArea: number
  values: CensusValues
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

export type EntityBufferResult = [id: number, tracts: TractIntersection[]]

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

function bufferQuery (kind: BufferEntityKind) {
  return gql`
    query (
      $ids: [Int!]!,
      $dataset: String,
      $layer: String!,
      $radius: Float!,
      $tableDataset: String,
      $tableNames: [String!]!
    ) {
      ${kind}(ids: $ids) {
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
}

function parseTractRow (g: BufferGeographyResponse, tableDataset: string): TractIntersection | null {
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
  }
}

export async function fetchEntityBufferTracts (
  kind: BufferEntityKind,
  config: FetchBufferConfig,
): Promise<EntityBufferResult[]> {
  const response = await config.client.query<Record<BufferEntityKind, BufferEntityResponse[]>>(
    bufferQuery(kind),
    {
      ids: config.ids,
      dataset: config.geoDataset,
      layer: config.layer,
      radius: config.radius,
      tableDataset: config.tableDataset,
      tableNames: config.tableNames,
    },
  )
  return (response.data?.[kind] || []).map((ent): EntityBufferResult => {
    const tracts: TractIntersection[] = []
    for (const g of ent.census_geographies || []) {
      const t = parseTractRow(g, config.tableDataset)
      if (t) {
        tracts.push(t)
      }
    }
    return [ent.id, tracts]
  })
}
