// Census-values pass: ACS values + intersection ratios for every geography
// of one census layer intersecting the scenario area. Shared by
// `ScenarioFetcher.fetchCensusValues()` (inline pipeline) and
// `streamCensusValues()` (the standalone /api/census-values endpoint that
// powers deferred, per-layer on-demand loading).

import bbox from '@turf/bbox'
import area from '@turf/area'
import {
  type Bbox,
  type CensusGeographyData,
  type GraphQLClient,
  fetchCensusIntersection,
  padBboxMeters,
  REQUIRED_ACS_TABLES,
} from '~~/src/core'
import { geographyLayerQuery } from '~~/src/tl/census'
import type { ScenarioProgress } from './scenario'

export interface CensusValuesFetchConfig {
  geoDatasetName: string
  tableDatasetName: string
  // Census layer to fetch ('tract', 'county', ...). One pass = one layer;
  // the receiver caches results per layer.
  layer: string
  // Pads the bbox so census geographies just outside the query area but
  // inside a stop buffer are still loaded for apportionment. Tied to the
  // radius alone — a deferred buffer load still needs the margin geographies.
  stopBufferRadius?: number
  bbox?: Bbox
  // Admin-boundary polygon; when set the server clips against it instead of
  // the bbox (see #347 for multi-boundary support).
  within?: GeoJSON.Polygon
}

export interface ResolvedArea {
  bbox?: Bbox
  within?: GeoJSON.Polygon
}

// Resolve the scenario's query area: either the explicit bbox, or a bbox
// (plus `within` polygon) computed around the selected admin boundaries.
// Single source of truth shared by `fetchFeedVersions` and the standalone
// census-values endpoint so both resolve identically. Runs server-side/BFF —
// @turf use here is bbox arithmetic plus picking the largest polygon part,
// not geometric math the backend must agree with.
export async function resolveScenarioArea (
  client: GraphQLClient,
  opts: { bbox?: Bbox, geographyIds?: number[], geoDatasetName: string },
): Promise<ResolvedArea> {
  let searchBbox = opts.bbox
  let within: GeoJSON.Polygon | undefined
  if (opts.geographyIds && opts.geographyIds.length > 0) {
    const geogResponse = await client.query<{ census_datasets: { geographies: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] }[] }>(
      geographyLayerQuery,
      {
        geography_ids: opts.geographyIds,
        include_geographies: true,
        dataset_name: opts.geoDatasetName,
      },
    )

    const features = geogResponse.data?.census_datasets?.[0]?.geographies?.map(g => ({
      type: 'Feature' as const,
      geometry: g.geometry,
      properties: {},
    })) || []

    if (features.length > 0) {
      const fc = {
        type: 'FeatureCollection' as const,
        features,
      }

      // Calculate bbox that contains all administrative boundaries
      const [minX, minY, maxX, maxY] = bbox(fc)
      searchBbox = {
        sw: { lon: minX, lat: minY },
        ne: { lon: maxX, lat: maxY },
        valid: true,
      }

      // Backend `within` is typed as Polygon, so for a MultiPolygon pick
      // the largest part as a stand-in until #347 lands.
      const firstGeom: GeoJSON.Geometry = features[0]!.geometry
      if (firstGeom.type === 'MultiPolygon' && firstGeom.coordinates.length > 0) {
        let bestCoords = firstGeom.coordinates[0]!
        let bestArea = area({ type: 'Polygon', coordinates: bestCoords })
        for (let i = 1; i < firstGeom.coordinates.length; i++) {
          const coords = firstGeom.coordinates[i]!
          const a = area({ type: 'Polygon', coordinates: coords })
          if (a > bestArea) {
            bestCoords = coords
            bestArea = a
          }
        }
        within = { type: 'Polygon', coordinates: bestCoords }
        if (firstGeom.coordinates.length > 1) {
          console.warn(`[Scenario] Admin boundary is a MultiPolygon with ${firstGeom.coordinates.length} parts; using the largest part for census intersection (#347).`)
        }
      } else if (firstGeom.type === 'Polygon') {
        within = firstGeom
      }
    } else {
      console.warn('No features found in census datasets response')
    }
  }
  return { bbox: searchBbox, within }
}

// Pure over its inputs; callers wrap `emit` with either a stream sender or
// the in-process ScenarioFetcher progress channel.
export async function runCensusValuesPass (
  config: CensusValuesFetchConfig,
  client: GraphQLClient,
  emit: (progress: ScenarioProgress) => void,
): Promise<void> {
  if (!config.bbox) {
    console.warn('[CensusValues] No resolved bbox — skipping')
    return
  }
  emit({ isLoading: true, currentStage: 'census-values' })
  const radius = config.stopBufferRadius && config.stopBufferRadius > 0
    ? config.stopBufferRadius
    : 0
  const fetchBbox = radius > 0 ? padBboxMeters(config.bbox, radius) : config.bbox
  console.log(`[CensusValues] Fetching ${REQUIRED_ACS_TABLES.length} ACS tables for layer=${config.layer} (radius padding=${radius}m)`)
  const features = await fetchCensusIntersection({
    client,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.layer,
    tableDatasetName: config.tableDatasetName,
    tableNames: REQUIRED_ACS_TABLES,
    bbox: fetchBbox,
    within: config.within,
  })
  const entries: [string, CensusGeographyData][] = features.map(f => [
    f.properties.geoid,
    {
      id: f.properties.geography_id,
      name: f.properties.name,
      values: f.properties.values,
      intersectionRatio: f.properties.intersection_ratio,
      geometryArea: f.properties.geometry_area,
      intersectionArea: f.properties.intersection_area,
      layer: config.layer,
    },
  ])
  console.log(`[CensusValues] Fetched values for ${entries.length} geographies`)
  emit({ isLoading: true, currentStage: 'census-values', partialData: { censusGeographies: entries } })
}
