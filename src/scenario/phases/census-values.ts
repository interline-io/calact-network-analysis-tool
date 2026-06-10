// Phase 6: ACS census values for the aggregation layer. Depends only on the
// resolved geographic context — independent of stops/routes/departures.

import {
  fetchCensusIntersection,
  padBboxMeters,
  REQUIRED_ACS_TABLES,
  type Bbox,
  type CensusGeographyData,
  type GraphQLClient,
} from '~~/src/core'
import { resolveGeographyContext } from './feed-versions'
import { phaseDone, type PhaseEmit } from './common'

export interface CensusValuesPhaseConfig {
  bbox?: Bbox
  // Admin-boundary selection; resolved to bbox + within when `within` is not
  // already provided (the standalone-request path).
  geographyIds?: number[]
  // Pre-resolved admin polygon from the feed-versions phase (the inline
  // path), so composition doesn't re-resolve per phase.
  within?: GeoJSON.Polygon
  geoDatasetName: string
  // ACS dataset (e.g. `acsdt5y2021`).
  tableDatasetName: string
  aggregateLayer: string
  // Bbox is padded by the radius so edge-crossing buffers can apportion
  // against the right tracts.
  stopBufferRadius?: number
}

export async function runCensusValuesPhase (
  config: CensusValuesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
): Promise<void> {
  let { bbox: fetchBbox, within } = config
  if (!within && config.geographyIds && config.geographyIds.length > 0) {
    const resolved = await resolveGeographyContext(config, client)
    fetchBbox = resolved.bbox ?? fetchBbox
    within = resolved.within
  }
  if (!fetchBbox) {
    console.warn('[CensusValues] No resolved bbox — skipping')
    emit({ isLoading: true, currentStage: 'census-values', phaseProgress: phaseDone('census-values') })
    return
  }

  emit({
    isLoading: true,
    currentStage: 'census-values',
    phaseProgress: { phase: 'census-values', completed: 0, total: 1 },
  })
  const radius = config.stopBufferRadius && config.stopBufferRadius > 0
    ? config.stopBufferRadius
    : 0
  const paddedBbox = radius > 0 ? padBboxMeters(fetchBbox, radius) : fetchBbox
  console.log(`[CensusValues] Fetching ${REQUIRED_ACS_TABLES.length} ACS tables for layer=${config.aggregateLayer} (radius padding=${radius}m)`)
  const features = await fetchCensusIntersection({
    client,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.aggregateLayer,
    tableDatasetName: config.tableDatasetName,
    tableNames: REQUIRED_ACS_TABLES,
    bbox: paddedBbox,
    within,
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
      layer: config.aggregateLayer,
    },
  ])
  console.log(`[CensusValues] Fetched values for ${entries.length} geographies`)
  emit({
    isLoading: true,
    currentStage: 'census-values',
    partialData: { censusGeographies: entries },
    phaseProgress: phaseDone('census-values'),
  })
}
