import { gql } from 'graphql-tag'
import type { Bbox, Geometry } from './geom'
import { convertBbox } from './geom'
import type { GraphQLClient } from './graphql'
import type { CensusValues } from './census-columns'

/**
 * Fetches census geographies (optionally constrained by bbox and/or stop
 * buffer) together with ACS values from one or more tables. Each returned
 * feature carries the raw `values` map plus the area-overlap ratio, which
 * callers can apply to apportion additive counts (population, HH counts)
 * across partial-coverage geographies.
 *
 * This is the single source of truth for the Transitland
 * `census_datasets.geographies` query shape with intersection data; consumers
 * include the scenario aggregation pipeline (#302) and the WSDOT analysis.
 */

export interface CensusGeographyFeature {
  id: string
  type: 'Feature'
  properties: {
    dataset_name: string
    layer_name: string
    geoid: string
    name: string
    adm0_iso?: string
    adm0_name?: string
    adm1_iso?: string
    adm1_name?: string
    geometry_area: number
    intersection_area: number
    /** intersection_area / geometry_area, clamped to [0, 1] */
    intersection_ratio: number
    values: CensusValues
  }
  geometry: Geometry | null
}

export interface FetchCensusIntersectionConfig {
  client: GraphQLClient
  geoDatasetName: string
  geoDatasetLayer: string
  tableDatasetName: string
  tableNames: string[]
  bbox?: Bbox
  stopIds?: Iterable<number>
  stopBufferRadius?: number
  includeIntersectionGeometry?: boolean
}

interface geographyIntersectionResponse {
  id: string
  name: string
  url: string
  geographies: {
    id: number
    name: string
    aland: number
    awater: number
    geoid: string
    layer_name: string
    geometry_area: number
    adm0_name: string
    adm0_iso: string
    adm1_name: string
    adm1_iso: string
    intersection_area: number
    intersection_geometry: Geometry | null
    values: {
      dataset_name: string
      geoid: string
      values: Record<string, number>
    }[]
  }[]
}

export const geographyIntersectionQuery = gql`
query (
  $geoDatasetName: String,
  $layer: String!,
  $tableNames: [String!]!,
  $tableDatasetName: String,
  $bbox: BoundingBox,
  $stopIds: [Int!],
  $stopBufferRadius: Float,
  $includeIntersectionGeometry: Boolean = false
) {
  census_datasets(where: {name: $geoDatasetName}) {
    id
    name
    url
    geographies(
      limit: 100000,
      where: {
        layer: $layer,
        location: {
          bbox: $bbox,
          stop_buffer: {stop_ids: $stopIds, radius: $stopBufferRadius}
        }
      }
    ) {
      id
      name
      aland
      awater
      geoid
      adm1_iso
      adm1_name
      adm0_iso
      adm0_name
      layer_name
      geometry_area
      intersection_area
      intersection_geometry @include(if: $includeIntersectionGeometry)
      values(dataset: $tableDatasetName, table_names: $tableNames) {
        dataset_name
        geoid
        values
      }
    }
  }
}
`

export async function fetchCensusIntersection (
  config: FetchCensusIntersectionConfig,
): Promise<CensusGeographyFeature[]> {
  const variables = {
    geoDatasetName: config.geoDatasetName,
    tableDatasetName: config.tableDatasetName,
    tableNames: config.tableNames,
    layer: config.geoDatasetLayer,
    stopBufferRadius: config.stopBufferRadius,
    stopIds: config.stopIds ? Array.from(config.stopIds) : [],
    bbox: convertBbox(config.bbox),
    includeIntersectionGeometry: config.includeIntersectionGeometry || false,
  }
  const result = await config.client.query<{ census_datasets: geographyIntersectionResponse[] }>(
    geographyIntersectionQuery,
    variables,
  )
  const features: CensusGeographyFeature[] = []
  for (const geoDataset of result.data?.census_datasets || []) {
    for (const geography of geoDataset.geographies || []) {
      const totalArea = geography.geometry_area || 0
      if (totalArea === 0) {
        continue
      }
      const intersectionArea = geography.intersection_area || 0
      const intersectionRatio = Math.min(intersectionArea / totalArea, 1.0)
      const valuesRow = geography.values.find(v => v.dataset_name === config.tableDatasetName)
      features.push({
        id: geography.geoid,
        type: 'Feature',
        properties: {
          name: geography.name,
          dataset_name: geoDataset.name,
          layer_name: geography.layer_name,
          geoid: geography.geoid,
          adm0_iso: geography.adm0_iso,
          adm0_name: geography.adm0_name,
          adm1_iso: geography.adm1_iso,
          adm1_name: geography.adm1_name,
          geometry_area: totalArea,
          intersection_area: intersectionArea,
          intersection_ratio: intersectionRatio,
          values: valuesRow?.values ?? {},
        },
        geometry: geography.intersection_geometry,
      })
    }
  }
  return features
}
