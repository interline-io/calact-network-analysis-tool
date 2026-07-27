// Phase 6: ACS census values for the aggregation layer. Depends on the
// resolved geographic context, plus the scenario's stop set when the
// intersection is narrowed to the stop buffers.

import {
  padBboxMeters,
  REQUIRED_ACS_TABLES,
  type Bbox,
  type CensusGeographyData,
  type GraphQLClient,
} from '~~/src/core'
import { fetchCensusIntersection, fetchClipIntersections } from '~~/src/tl'
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
  // With a radius and a `within` polygon, a second pass narrows each
  // geography's intersection to the query area AND the stop buffers.
  stopIds?: number[]
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

  // Second pass: intersection with the query area AND the stop buffers. The
  // first pass stays the row universe, so geographies the buffers don't reach
  // are kept and reported at zero rather than dropped by the server's clip.
  // Needs a `within` polygon — the backend ignores a stop buffer alongside a
  // bbox, so a bbox-only scenario keeps query-area intersections.
  const stopIds = config.stopIds || []
  const clips = within && radius > 0 && stopIds.length > 0
    ? await fetchClipIntersections({
        client,
        geoDatasetName: config.geoDatasetName,
        geoDatasetLayer: config.aggregateLayer,
        within,
        stopIds,
        stopBufferRadius: radius,
      })
    : null
  if (clips) {
    console.log(`[CensusValues] Clipped to stop buffers (radius=${radius}m, ${stopIds.length} stops): ${clips.size}/${features.length} geographies overlap`)
  }

  const entries: [string, CensusGeographyData][] = features.map((f) => {
    const geometryArea = f.properties.geometry_area
    // Both clips are kept: the choropleth mode picks between them at display
    // time, so switching never needs a refetch.
    const bufferArea = clips ? (clips.get(f.properties.geoid) ?? 0) : undefined
    return [
      f.properties.geoid,
      {
        id: f.properties.geography_id,
        name: f.properties.name,
        values: f.properties.values,
        intersectionRatio: f.properties.intersection_ratio,
        geometryArea,
        intersectionArea: f.properties.intersection_area,
        bufferIntersectionArea: bufferArea,
        bufferIntersectionRatio: bufferArea == null
          ? undefined
          : (geometryArea > 0 ? Math.min(bufferArea / geometryArea, 1.0) : 0),
        layer: config.aggregateLayer,
      },
    ]
  })
  console.log(`[CensusValues] Fetched values for ${entries.length} geographies`)
  emit({
    isLoading: true,
    currentStage: 'census-values',
    partialData: { censusGeographies: entries },
    phaseProgress: phaseDone('census-values'),
  })
}
