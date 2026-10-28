import { gql } from 'graphql-tag'
import { chunkArray, collectPolygons, hasSearchArea, queryAreaVariables, type Geometry, type GraphQLClient, type CensusValues, type QueryArea } from '~~/src/core'
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

export interface FetchCensusIntersectionConfig extends QueryArea {
  client: GraphQLClient
  geoDatasetName: string
  geoDatasetLayer: string
  tableDatasetName: string
  tableNames: string[]
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
query GeographyIntersection(
  $geoDatasetName: String,
  $layer: String!,
  $tableNames: [String!]!,
  $tableDatasetName: String,
  $bbox: BoundingBox,
  $within: Polygon,
  $geographyIds: [Int!],
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
        dataset: $geoDatasetName,
        layer: $layer,
        location: {
          bbox: $bbox,
          within: $within,
          geography_ids: $geographyIds,
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

export interface FetchClipIntersectionsConfig extends QueryArea {
  client: GraphQLClient
  geoDatasetName: string
  geoDatasetLayer: string
  stopIds: Iterable<number>
  stopBufferRadius: number
  // Clip to the part of the query area outside the stop buffers instead.
  exclude?: boolean
  // Roughly doubles the response size, so callers ask only when the clipped
  // outline is actually being drawn.
  includeGeometry?: boolean
}

export interface ClipIntersection {
  area: number
  geometry?: Geometry
}

// The query area ∩ stop buffers clip, or with `exclude` the query area minus
// the stop buffers. Values come from the query-area pass, so this fetches areas
// only unless the caller wants the outline too. A geography absent from the
// result has no area in the clip.
export const clipIntersectionQuery = gql`
query ClipIntersection(
  $geoDatasetName: String,
  $layer: String!,
  $bbox: BoundingBox,
  $within: Polygon,
  $geographyIds: [Int!],
  $stopIds: [Int!],
  $stopBufferRadius: Float,
  $exclude: Boolean = false,
  $includeGeometry: Boolean = false
) {
  census_datasets(where: {name: $geoDatasetName}) {
    id
    geographies(
      limit: 100000,
      where: {
        dataset: $geoDatasetName,
        layer: $layer,
        location: {
          bbox: $bbox,
          within: $within,
          geography_ids: $geographyIds,
          stop_buffer: {stop_ids: $stopIds, radius: $stopBufferRadius, exclude: $exclude}
        }
      }
    ) {
      geoid
      intersection_area
      intersection_geometry @include(if: $includeGeometry)
    }
  }
}
`

// Intersection of each geography with the clip, keyed by geoid. Geographies
// the clip doesn't reach are omitted by the server; callers should treat a
// missing key as zero overlap.
export async function fetchClipIntersections (
  config: FetchClipIntersectionsConfig,
): Promise<Map<string, ClipIntersection>> {
  const stopIds = Array.from(config.stopIds)
  const out = new Map<string, ClipIntersection>()
  if (!hasSearchArea(config) || stopIds.length === 0 || !(config.stopBufferRadius > 0)) {
    return out
  }
  const results = await queryEachPass(config, pass => config.client.query<{
    census_datasets: {
      geographies: {
        geoid: string
        intersection_area: number | null
        intersection_geometry?: Geometry | null
      }[]
    }[]
  }>(clipIntersectionQuery, {
    geoDatasetName: config.geoDatasetName,
    layer: config.geoDatasetLayer,
    ...pass,
    stopIds,
    stopBufferRadius: config.stopBufferRadius,
    exclude: config.exclude || false,
    includeGeometry: config.includeGeometry || false,
  }))
  for (const result of results) {
    for (const geoDataset of result.data?.census_datasets || []) {
      for (const geography of geoDataset.geographies || []) {
        // Sum so a clip split across a polygon's parts isn't reduced to one
        // part. Within one pass the composed clip yields one row per geoid;
        // across passes the parts' clipped outlines are collected together.
        const prev = out.get(geography.geoid)
        out.set(geography.geoid, {
          area: (prev?.area || 0) + (geography.intersection_area || 0),
          geometry: collectPolygons(prev?.geometry, geography.intersection_geometry ?? undefined),
        })
      }
    }
  }
  return out
}

export interface FetchBufferClipGeometryConfig {
  client: GraphQLClient
  geoDatasetName: string
  geoDatasetLayer: string
  stopIds: Iterable<number>
  stopBufferRadius: number
}

// Outlines of each geography clipped to a union of stop buffers, with no
// query area and no ACS values — the display-only half of what
// geographyIntersectionQuery returns, for callers that already hold the areas.
//
// Unlike clipIntersectionQuery this composes no second clip, so the backend
// returns one row per disjoint part of the buffer union: a geography split by
// a gap between buffers appears more than once. The parts are the shapes to
// draw, so they are returned as a flat list rather than keyed by geoid.
export const bufferClipGeometryQuery = gql`
query BufferClipGeometry(
  $geoDatasetName: String,
  $layer: String!,
  $stopIds: [Int!],
  $stopBufferRadius: Float
) {
  census_datasets(where: {name: $geoDatasetName}) {
    id
    geographies(
      limit: 100000,
      where: {
        dataset: $geoDatasetName,
        layer: $layer,
        location: {stop_buffer: {stop_ids: $stopIds, radius: $stopBufferRadius}}
      }
    ) {
      intersection_geometry
    }
  }
}
`

// The clipped outlines for one stop set, in no particular order. Geographies
// the buffers don't reach are omitted by the server.
export async function fetchBufferClipGeometry (
  config: FetchBufferClipGeometryConfig,
): Promise<Geometry[]> {
  const stopIds = Array.from(config.stopIds)
  if (stopIds.length === 0 || !(config.stopBufferRadius > 0)) {
    return []
  }
  const result = await config.client.query<{
    census_datasets: { geographies: { intersection_geometry: Geometry | null }[] }[]
  }>(bufferClipGeometryQuery, {
    geoDatasetName: config.geoDatasetName,
    layer: config.geoDatasetLayer,
    stopIds,
    stopBufferRadius: config.stopBufferRadius,
  })
  const out: Geometry[] = []
  for (const geoDataset of result.data?.census_datasets || []) {
    for (const geography of geoDataset.geographies || []) {
      if (geography.intersection_geometry) {
        out.push(geography.intersection_geometry)
      }
    }
  }
  return out
}

// The query-area variables for each request a census query takes: one per
// part of a polygon, since `within` takes a single Polygon, or else one with
// the bbox or geography ids (both unset for a stops-only query).
function areaPasses (config: QueryArea): { bbox?: ReturnType<typeof queryAreaVariables>['bbox'], within?: GeoJSON.Polygon, geographyIds?: number[] }[] {
  const area = queryAreaVariables(config)
  if (area.polygons) {
    return area.polygons.map(within => ({ within }))
  }
  return [{ bbox: area.bbox, geographyIds: area.geographyIds }]
}

// How many of a polygon's parts are queried at once, as the scenario phases
// cap their requests. A file of hundreds of districts shouldn't send hundreds
// of census queries together.
const AREA_PASS_CONCURRENCY = 8

// Runs a census query once per area pass, a few at a time, in pass order
async function queryEachPass<T> (config: QueryArea, run: (pass: ReturnType<typeof areaPasses>[number]) => Promise<T>): Promise<T[]> {
  const results: T[] = []
  for (const batch of chunkArray(areaPasses(config), AREA_PASS_CONCURRENCY)) {
    results.push(...await Promise.all(batch.map(run)))
  }
  return results
}

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
    includeIntersectionGeometry: config.includeIntersectionGeometry || false,
  }
  const results = await queryEachPass(config, pass =>
    config.client.query<{ census_datasets: geographyIntersectionResponse[] }>(
      geographyIntersectionQuery,
      { ...variables, ...pass },
    ))
  const features: CensusGeographyFeature[] = []
  // A geography that straddles parts of a polygon comes back once per part,
  // each with the area inside that part. Summed, they give its intersection
  // with the whole polygon where the parts don't overlap; where they do, the
  // overlap counts twice (the UI says so). The ratio is capped at 1.
  const byGeoid = new Map<string, CensusGeographyFeature>()
  for (const geoDataset of results.flatMap(result => result.data?.census_datasets || [])) {
    for (const geography of geoDataset.geographies || []) {
      const totalArea = geography.geometry_area || 0
      if (totalArea === 0) {
        continue
      }
      const prev = byGeoid.get(geography.geoid)
      if (prev) {
        prev.properties.intersection_area += geography.intersection_area || 0
        prev.properties.intersection_ratio = Math.min(prev.properties.intersection_area / totalArea, 1.0)
        prev.geometry = collectPolygons(prev.geometry ?? undefined, geography.intersection_geometry ?? undefined) ?? null
        continue
      }
      const intersectionArea = geography.intersection_area || 0
      const intersectionRatio = Math.min(intersectionArea / totalArea, 1.0)
      // Flatten the per-(geography, table) value rows into one keyed map.
      const values = parseAcsValues(geography.values, config.tableDatasetName)
      const feature: CensusGeographyFeature = {
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
      }
      byGeoid.set(geography.geoid, feature)
      features.push(feature)
    }
  }
  return features
}
