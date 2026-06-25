import { gql } from 'graphql-tag'
import { convertBbox, type Bbox, type Geometry, type GraphQLClient, type CensusValues } from '~~/src/core'
import { parseAcsValues } from './census'

// Single source of truth for the Transitland `census_datasets.geographies`
// query with intersection data. Used by both the scenario pipeline and WSDOT.

export interface CensusGeographyFeature {
  id: string
  type: 'Feature'
  properties: {
    geography_id: number
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
  // Polygon to clip against — server computes intersection_area against this
  // rather than an axis-aligned bbox. Takes precedence over `bbox`.
  within?: GeoJSON.Polygon
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
  $within: Polygon,
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
          within: $within,
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
      # Explicit high limit: the backend applies a small default to nested
      # lists, which silently truncates results to a subset of the requested
      # tables. We need one values row per (geography, table) pair, so bound
      # this well above REQUIRED_ACS_TABLES.length.
      values(dataset: $tableDatasetName, table_names: $tableNames, limit: 1000) {
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
    bbox: config.within ? undefined : convertBbox(config.bbox),
    within: config.within,
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
      // Flatten the per-(geography, table) value rows into one keyed map.
      const values = parseAcsValues(geography.values, config.tableDatasetName)
      features.push({
        id: geography.geoid,
        type: 'Feature',
        properties: {
          geography_id: geography.id,
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
          values,
        },
        geometry: geography.intersection_geometry,
      })
    }
  }
  return features
}
