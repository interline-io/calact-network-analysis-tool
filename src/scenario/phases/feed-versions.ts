// Phase 1: resolve the geographic context and the active feed versions in it.
// Everything downstream takes feed version sha1s (stops, flex) or the
// resolved bbox/within polygon (census values) as input.

import bbox from '@turf/bbox'
import area from '@turf/area'
import { convertBbox, type Bbox, type GraphQLClient } from '~~/src/core'
import {
  applyFeedVersionOverrides,
  feedVersionQuery,
  feedVersionsByIdsQuery,
  HIDDEN_FEED_ONESTOP_IDS,
  type FeedGql,
  type FeedVersion,
} from '~~/src/tl'
import { geographyLayerQuery } from '~~/src/tl/census'
import type { PhaseEmit } from './common'

const FEED_VERSION_PAGE_SIZE = 100

export interface FeedVersionsPhaseConfig {
  bbox?: Bbox
  geographyIds?: number[]
  geoDatasetName: string
  // Picker overrides: onestop_id → fv_id. Record (not Map) for BFF JSON.
  feedVersionOverrides?: Record<string, number>
  // Picker-excluded onestop_ids. Dropped before any stop/route fetch.
  excludedFeeds?: string[]
}

export interface ResolvedGeographyContext {
  // User bbox, or computed around the selected admin boundaries.
  bbox?: Bbox
  // First admin polygon, used as `within` for census intersection so the
  // server clips against the real polygon. Multi-boundary support is #347.
  within?: GeoJSON.Polygon
}

// geographyIds → bounding box + `within` polygon. Shared with the standalone
// census-values phase so its endpoint can re-resolve from ids without the
// caller threading resolved context across requests.
export async function resolveGeographyContext (
  config: { bbox?: Bbox, geographyIds?: number[], geoDatasetName: string },
  client: GraphQLClient,
): Promise<ResolvedGeographyContext> {
  const resolved: ResolvedGeographyContext = { bbox: config.bbox }
  if (!config.geographyIds || config.geographyIds.length === 0) {
    return resolved
  }

  // First get the geometry for the administrative boundaries
  const geogResponse = await client.query<{ census_datasets: { geographies: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] }[] }>(
    geographyLayerQuery,
    {
      geography_ids: config.geographyIds,
      include_geographies: true,
      dataset_name: config.geoDatasetName
    }
  )

  // Combine all geometries into a FeatureCollection
  const features = geogResponse.data?.census_datasets?.[0]?.geographies?.map(g => ({
    type: 'Feature' as const,
    geometry: g.geometry,
    properties: {}
  })) || []

  if (features.length === 0) {
    console.warn('No features found in census datasets response')
    return resolved
  }

  // Calculate bbox that contains all administrative boundaries
  const [minX, minY, maxX, maxY] = bbox({
    type: 'FeatureCollection' as const,
    features
  })
  resolved.bbox = {
    sw: { lon: minX, lat: minY },
    ne: { lon: maxX, lat: maxY },
    valid: true
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
    resolved.within = { type: 'Polygon', coordinates: bestCoords }
    if (firstGeom.coordinates.length > 1) {
      console.warn(`[Scenario] Admin boundary is a MultiPolygon with ${firstGeom.coordinates.length} parts; using the largest part for census intersection (#347).`)
    }
  } else if (firstGeom.type === 'Polygon') {
    resolved.within = firstGeom
  }
  return resolved
}

// GraphQL lookup + warning surfacing wrapped around applyFeedVersionOverrides
// (pure projection, tested separately). Returns warnings for the caller to
// attach to its progress emission.
async function resolveFeedVersionsForScenario (
  config: FeedVersionsPhaseConfig,
  allFeeds: FeedGql[],
  client: GraphQLClient,
): Promise<{ feedVersions: FeedVersion[], warnings: string[] }> {
  const overrides = new Map<string, number>(
    config.feedVersionOverrides ? Object.entries(config.feedVersionOverrides) : []
  )
  const excluded = new Set<string>(config.excludedFeeds || [])

  const overrideById = new Map<number, FeedVersion>()
  if (overrides.size > 0) {
    const needed: number[] = []
    for (const f of allFeeds) {
      if (excluded.has(f.onestop_id)) { continue }
      const id = overrides.get(f.onestop_id)
      if (id != null) { needed.push(id) }
    }
    if (needed.length > 0) {
      const resp = await client.query<{ feed_versions: FeedVersion[] }>(
        feedVersionsByIdsQuery,
        { ids: needed }
      )
      for (const fv of resp.data?.feed_versions || []) {
        // fv.id arrives as a string from GraphQL — coerce for Map key parity.
        const idNum = typeof fv.id === 'string' ? parseInt(fv.id, 10) : fv.id
        if (Number.isFinite(idNum)) { overrideById.set(idNum, fv) }
      }
    }
  }

  const { feedVersions, missing } = applyFeedVersionOverrides(allFeeds, overrides, excluded, overrideById)
  const warnings: string[] = []
  if (missing.length > 0) {
    const msg = `Could not resolve ${missing.length} pinned feed version(s): ${missing.map(m => `${m.onestop_id}:${m.fv_id}`).join(', ')}`
    console.warn(`[Scenario] ${msg}`)
    warnings.push(msg)
  }
  return { feedVersions, warnings }
}

// Fetch active feed versions in the specified area
export async function runFeedVersionsPhase (
  config: FeedVersionsPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
): Promise<{ feedVersions: FeedVersion[], resolved: ResolvedGeographyContext }> {
  const resolved = await resolveGeographyContext(config, client)

  // Use the bbox (either user-specified or computed around admin boundaries)
  // to query feed versions. Paginate to ensure we get all feeds (API default
  // limit is 100).
  const bboxForQuery = convertBbox(resolved.bbox)
  const allFeeds: FeedGql[] = []
  let after = 0
  while (true) {
    const variables = { where: { bbox: bboxForQuery }, limit: FEED_VERSION_PAGE_SIZE, after }
    const response = await client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const page = response.data?.feeds || []
    // Drop feeds with known-broken bbox metadata so they don't poison
    // every other bbox query with their over-broad coverage claim.
    for (const f of page) {
      if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
      allFeeds.push(f)
    }
    if (page.length < FEED_VERSION_PAGE_SIZE) {
      break
    }
    const nextAfter = parseInt(page[page.length - 1]!.id, 10)
    if (!Number.isInteger(nextAfter)) {
      throw new Error(`[FeedVersions] Invalid pagination cursor: id="${page[page.length - 1]!.id}" did not parse as an integer`)
    }
    after = nextAfter
  }

  const { feedVersions, warnings } = await resolveFeedVersionsForScenario(config, allFeeds, client)
  console.log(`Found ${feedVersions.length} feed versions`)
  for (const fv of feedVersions) {
    console.log(`    ${fv.feed?.onestop_id} ${fv.sha1}`)
  }

  emit({
    isLoading: true,
    currentStage: 'feed-versions',
    partialData: { feedVersions },
    warnings: warnings.length > 0 ? warnings : undefined,
  })

  return { feedVersions, resolved }
}
