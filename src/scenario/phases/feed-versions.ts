// Phase 1: the active feed versions in the query area. Everything downstream
// takes feed version sha1s (stops, flex) as input.

import { convertBbox, mergePolygons, polygonBbox, type Bbox, type GraphQLClient, type QueryArea } from '~~/src/core'
import {
  applyFeedVersionOverrides,
  feedVersionQuery,
  feedVersionsByIdsQuery,
  type FeedGql,
  type FeedVersion,
} from '~~/src/tl'
import { geographyLayerQuery } from '~~/src/tl/census'
import { phaseDone, type PhaseEmit } from './common'

const FEED_VERSION_PAGE_SIZE = 100

export interface FeedVersionsPhaseConfig extends QueryArea {
  geoDatasetName: string
  // Picker overrides: onestop_id → fv_id. Record (not Map) for BFF JSON.
  feedVersionOverrides?: Record<string, number>
  // Picker-excluded onestop_ids. Dropped before any stop/route fetch.
  excludedFeeds?: string[]
}

// The bbox to search for feeds: one around the query polygon, or around the
// selected admin boundaries when they resolve to geometry, or the user's.
async function resolveSearchBbox (
  config: QueryArea & { geoDatasetName: string },
  client: GraphQLClient,
): Promise<Bbox | undefined> {
  if (config.polygon?.coordinates.length) {
    return polygonBbox(config.polygon)
  }
  if (!config.geographyIds || config.geographyIds.length === 0) {
    return config.bbox
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
  const geometries = (geogResponse.data?.census_datasets?.[0]?.geographies || []).map(g => g.geometry).filter(Boolean)
  if (geometries.length === 0) {
    console.warn('No features found in census datasets response')
    return config.bbox
  }
  return polygonBbox(mergePolygons(geometries))
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
): Promise<FeedVersion[]> {
  const searchBbox = await resolveSearchBbox(config, client)

  // Fail fast rather than paginate the world: with no bbox the feeds query
  // is unbounded and would return every feed in the system.
  if (!searchBbox) {
    throw new Error('[FeedVersions] No search area — bbox missing and the polygon or geographyIds resolved to no geometries')
  }

  // Use the bbox (either user-specified or computed around admin boundaries)
  // to query feed versions. Paginate to ensure we get all feeds (API default
  // limit is 100).
  const bboxForQuery = convertBbox(searchBbox)
  const allFeeds: FeedGql[] = []
  let after = 0
  while (true) {
    const variables = { where: { bbox: bboxForQuery }, limit: FEED_VERSION_PAGE_SIZE, after }
    const response = await client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const page = response.data?.feeds || []
    allFeeds.push(...page)
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

  await emit({
    currentStage: 'feed-versions',
    partialData: { feedVersions },
    warnings: warnings.length > 0 ? warnings : undefined,
    phaseProgress: phaseDone('feed-versions'),
  })

  return feedVersions
}
