import { gql } from 'graphql-tag'
import type { Bbox, Geometry } from './geom'
import { convertBbox } from './geom'
import type { GraphQLClient } from './graphql'
import type { CensusValues } from './census-columns'

// Single source of truth for the Transitland `census_datasets.geographies`
// query with intersection data. Used by both the scenario pipeline and WSDOT.

export interface CensusGeographyData {
  id: number
  name: string
  /** Raw ACS values keyed by `<table>_<col>` (e.g. `b01001_001`). */
  values: CensusValues
  /** Fraction of the geography inside the query area, in [0, 1]. */
  intersectionRatio: number
  /** Full geography area in m². */
  geometryArea: number
  /** Intersection (geography ∩ query area) in m². */
  intersectionArea: number
}

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

// ACS "jam values": negative sentinels the Census Bureau publishes in place
// of an estimate when the value is unavailable, not applicable, or suppressed
// for sample size. Drop them so derivations + the UI see missing data and
// render "—" instead of surfacing e.g. -$666,666,666 as median income.
// Authoritative list: 2024_Jam_Values.xlsx on
// census.gov/programs-surveys/acs/technical-documentation/code-lists.html.
// (MoE-only jam values like -222222222 are intentionally omitted — we read
// estimate fields, not MoE.)
const ACS_JAM_VALUES = new Set<number>([
  -666666666, -888888888, -999999999,
])

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
      // Backend returns one entry per (geography, ACS table); flatten them
      // into a single keyed map for consumers, dropping ACS jam values.
      const values: CensusValues = {}
      for (const row of geography.values || []) {
        if (row.dataset_name !== config.tableDatasetName) {
          continue
        }
        for (const [k, v] of Object.entries(row.values)) {
          if (typeof v === 'number' && Number.isFinite(v) && !ACS_JAM_VALUES.has(v)) {
            values[k] = v
          }
        }
      }
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
