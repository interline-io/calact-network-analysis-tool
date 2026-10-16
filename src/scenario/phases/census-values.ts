// Phase 6: ACS census values for the aggregation layer. Depends on the query
// area, plus the scenario's stop set when the intersection is narrowed to the
// stop buffers.

import {
  REQUIRED_ACS_TABLES,
  hasSearchArea,
  type Bbox,
  type CensusGeographyData,
  type GraphQLClient,
} from '~~/src/core'
import { fetchCensusIntersection, fetchClipIntersections, type ClipIntersection } from '~~/src/tl'
import { phaseDone, type PhaseEmit } from './common'

export interface CensusValuesPhaseConfig {
  bbox?: Bbox
  // Admin-boundary selection. The server clips to their union, in place of
  // the bbox.
  geographyIds?: number[]
  geoDatasetName: string
  // ACS dataset (e.g. `acsdt5y2021`).
  tableDatasetName: string
  aggregateLayer: string
  stopBufferRadius?: number
  // With a radius, a second pass narrows each geography's intersection to the
  // query area AND the stop buffers.
  stopIds?: number[]
  // Also fetch the clipped outlines, for drawing the choropleth as the
  // analyzed footprint rather than whole geographies. Off by default: the
  // outlines cost roughly as much as the values.
  includeIntersectionGeometry?: boolean
}

export async function runCensusValuesPhase (
  config: CensusValuesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
): Promise<void> {
  if (!hasSearchArea(config)) {
    console.warn('[CensusValues] No query area — skipping')
    emit({ currentStage: 'census-values', phaseProgress: phaseDone('census-values') })
    return
  }

  emit({
    currentStage: 'census-values',
    phaseProgress: { phase: 'census-values', completed: 0, total: 1 },
  })
  const radius = config.stopBufferRadius && config.stopBufferRadius > 0
    ? config.stopBufferRadius
    : 0
  console.log(`[CensusValues] Fetching ${REQUIRED_ACS_TABLES.length} ACS tables for layer=${config.aggregateLayer}`)
  const features = await fetchCensusIntersection({
    client,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.aggregateLayer,
    tableDatasetName: config.tableDatasetName,
    tableNames: REQUIRED_ACS_TABLES,
    bbox: config.bbox,
    geographyIds: config.geographyIds,
    includeIntersectionGeometry: config.includeIntersectionGeometry,
  })

  // Second pass: intersection with the query area AND the stop buffers. The
  // first pass stays the row universe, so a geography the buffers don't reach
  // is reported at zero rather than dropped by the server's clip — display
  // decides whether to draw it. Clips against the same query area pass 1 used,
  // so the two areas stay comparable.
  //
  // Optional by design: a failure here must not lose the ACS values pass 1
  // already fetched, so it degrades to query-area-only rather than failing
  // the scenario.
  const stopIds = config.stopIds || []
  let clips: Map<string, ClipIntersection> | null = null
  if (radius > 0 && stopIds.length > 0) {
    try {
      clips = await fetchClipIntersections({
        client,
        geoDatasetName: config.geoDatasetName,
        geoDatasetLayer: config.aggregateLayer,
        bbox: config.bbox,
        geographyIds: config.geographyIds,
        stopIds,
        stopBufferRadius: radius,
        includeGeometry: config.includeIntersectionGeometry,
      })
    } catch (err) {
      console.warn('[CensusValues] Stop buffer clip failed; keeping query-area intersections', err)
    }
  }
  if (clips) {
    console.log(`[CensusValues] Clipped to query area + stop buffers (radius=${radius}m, ${stopIds.length} stops): ${clips.size}/${features.length} geographies overlap`)
  }

  const entries: [string, CensusGeographyData][] = features.map((f) => {
    const geometryArea = f.properties.geometry_area
    // Both clips are kept: the choropleth mode picks between them at display
    // time, so switching never needs a refetch.
    const clip = clips?.get(f.properties.geoid)
    const bufferArea = clips ? (clip?.area ?? 0) : undefined
    return [
      f.properties.geoid,
      {
        id: f.properties.geography_id,
        name: f.properties.name,
        values: f.properties.values,
        intersectionRatio: f.properties.intersection_ratio,
        geometryArea,
        intersectionArea: f.properties.intersection_area,
        intersectionGeometry: f.geometry ?? undefined,
        bufferIntersectionArea: bufferArea,
        bufferIntersectionRatio: bufferArea == null
          ? undefined
          : (geometryArea > 0 ? Math.min(bufferArea / geometryArea, 1.0) : 0),
        bufferIntersectionGeometry: clip?.geometry,
        layer: config.aggregateLayer,
      },
    ]
  })
  console.log(`[CensusValues] Fetched values for ${entries.length} geographies`)
  await emit({
    currentStage: 'census-values',
    partialData: { censusGeographies: entries },
    phaseProgress: phaseDone('census-values'),
  })
}
