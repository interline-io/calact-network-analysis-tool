// Phase 6: ACS census values for the aggregation layer. Depends on the query
// area, plus the scenario's stop set for the stop-buffer clips.

import {
  REQUIRED_ACS_TABLES,
  hasSearchArea,
  type CensusGeographyData,
  type Geometry,
  type GraphQLClient,
  queryArea,
  type QueryArea,
} from '~~/src/core'
import { fetchCensusIntersection, fetchClipIntersections, type ClipIntersection } from '~~/src/tl'
import { phaseDone, type PhaseEmit } from './common'

export interface CensusValuesPhaseConfig extends QueryArea {
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
  // With a radius, a third pass clips each geography to the query area
  // outside the stop buffers. Off by default: it costs a server pass.
  includeOutsideClip?: boolean
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
    ...queryArea(config),
    includeIntersectionGeometry: config.includeIntersectionGeometry,
  })

  // Clip passes: intersection with the query area AND the stop buffers, then,
  // when asked, with the query area outside them. The first pass stays the
  // row universe, so a geography a clip doesn't reach is reported at zero
  // rather than dropped by the server's clip, and display decides whether to
  // draw the geography. Both clip against the same query area pass 1 used, so
  // the areas stay comparable.
  //
  // Optional by design: a failure here must not lose the ACS values pass 1
  // already fetched, so each degrades to query-area-only rather than failing
  // the scenario.
  const stopIds = config.stopIds || []
  async function fetchClip (exclude: boolean): Promise<Map<string, ClipIntersection> | null> {
    if (!(radius > 0 && stopIds.length > 0)) {
      return null
    }
    try {
      return await fetchClipIntersections({
        client,
        geoDatasetName: config.geoDatasetName,
        geoDatasetLayer: config.aggregateLayer,
        ...queryArea(config),
        stopIds,
        stopBufferRadius: radius,
        exclude,
        includeGeometry: config.includeIntersectionGeometry,
      })
    } catch (err) {
      console.warn(`[CensusValues] ${exclude ? 'Outside' : 'Stop buffer'} clip failed; keeping query-area intersections`, err)
      return null
    }
  }
  const clips = await fetchClip(false)
  if (clips) {
    console.log(`[CensusValues] Clipped to query area + stop buffers (radius=${radius}m, ${stopIds.length} stops): ${clips.size}/${features.length} geographies overlap`)
  }
  const outsideClips = config.includeOutsideClip ? await fetchClip(true) : null
  if (outsideClips) {
    console.log(`[CensusValues] Clipped to query area outside stop buffers: ${outsideClips.size}/${features.length} geographies reach outside`)
  }

  const entries: [string, CensusGeographyData][] = features.map((f) => {
    const geometryArea = f.properties.geometry_area
    // Every clip is kept: the choropleth mode picks between them at display
    // time, so switching never needs a refetch.
    const buffer = clipFields(clips, f.properties.geoid, geometryArea)
    const outside = clipFields(outsideClips, f.properties.geoid, geometryArea)
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
        bufferIntersectionArea: buffer.area,
        bufferIntersectionRatio: buffer.ratio,
        bufferIntersectionGeometry: buffer.geometry,
        outsideIntersectionArea: outside.area,
        outsideIntersectionRatio: outside.ratio,
        outsideIntersectionGeometry: outside.geometry,
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

// One geography's fields for one clip: all undefined when the clip wasn't
// fetched, and zero area when the clip doesn't reach the geography.
function clipFields (
  clips: Map<string, ClipIntersection> | null,
  geoid: string,
  geometryArea: number,
): { area?: number, ratio?: number, geometry?: Geometry } {
  if (!clips) {
    return {}
  }
  const clip = clips.get(geoid)
  const area = clip?.area ?? 0
  return {
    area,
    ratio: geometryArea > 0 ? Math.min(area / geometryArea, 1.0) : 0,
    geometry: clip?.geometry,
  }
}
