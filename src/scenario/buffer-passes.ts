// Buffer-only passes for #315. Shared by `ScenarioFetcher.fetchBufferData()`
// (inline pipeline) and `streamBufferGeographies()` (the standalone refetch
// endpoint that fires when the user changes radius/layer).

import {
  type GraphQLClient,
  chunkArray,
  fetchCensusIntersection,
  REQUIRED_ACS_TABLES,
} from '~~/src/core'
import {
  fetchEntityBufferGeographies,
  type BufferEntityKind,
  type BufferGeographyIntersection,
} from '~~/src/tl'
import type { ScenarioProgress } from './scenario'

// Smaller than the stop batch because each route/agency expands to its full
// stop set server-side, multiplying per-request cost.
const BUFFER_ENTITY_BATCH_SIZE = 50

const BUFFER_PASS_BY_KIND = {
  stops: { stage: 'stop-buffer-geographies', partialKey: 'stopBufferGeographies' },
  routes: { stage: 'route-buffer-geographies', partialKey: 'routeBufferGeographies' },
  agencies: { stage: 'agency-buffer-geographies', partialKey: 'agencyBufferGeographies' },
} as const

export interface BufferFetchConfig {
  radius: number
  layer: string
  geoDatasetName: string
  tableDatasetName: string
  stopIds: number[]
  routeIds: number[]
  agencyIds: number[]
  // Default 100 — matches ScenarioFetcher's stopTimeBatchSize.
  stopChunkSize?: number
  // Default 50 — matches BUFFER_ENTITY_BATCH_SIZE.
  entityChunkSize?: number
}

// Pure over its inputs; callers wrap `emit` with either a stream sender or
// an in-process accumulator.
export async function runBufferPasses (
  config: BufferFetchConfig,
  client: GraphQLClient,
  emit: (progress: ScenarioProgress) => void,
): Promise<void> {
  const stopChunkSize = config.stopChunkSize ?? 100
  const entityChunkSize = config.entityChunkSize ?? BUFFER_ENTITY_BATCH_SIZE
  const baseConfig = {
    client,
    geoDataset: config.geoDatasetName,
    tableDataset: config.tableDatasetName,
    tableNames: REQUIRED_ACS_TABLES,
    layer: config.layer,
    radius: config.radius,
  }
  const passes: Array<{ kind: BufferEntityKind, ids: number[], batchSize: number }> = [
    { kind: 'stops', ids: config.stopIds, batchSize: stopChunkSize },
    { kind: 'routes', ids: config.routeIds, batchSize: entityChunkSize },
    { kind: 'agencies', ids: config.agencyIds, batchSize: entityChunkSize },
  ]
  // Total chunk count is known up front, so the consumer can render a real
  // progress bar. +1 for the single Pass F aggregation request.
  const bufferProgressTotal = passes.reduce(
    (n, p) => n + Math.ceil(p.ids.length / p.batchSize),
    config.stopIds.length > 0 ? 1 : 0,
  )
  let bufferProgressCompleted = 0
  const bufferProgress = () => ({ total: bufferProgressTotal, completed: bufferProgressCompleted })
  for (const { kind, ids, batchSize } of passes) {
    const { stage, partialKey } = BUFFER_PASS_BY_KIND[kind]
    for (const chunk of chunkArray(ids, batchSize)) {
      const results = await fetchEntityBufferGeographies(kind, { ...baseConfig, ids: chunk })
      bufferProgressCompleted += 1
      emit({
        isLoading: true,
        currentStage: stage,
        bufferProgress: bufferProgress(),
        partialData: { [partialKey]: results },
      })
    }
  }

  // Pass F — server-side union of every stop's buffer ∩ tracts.
  if (config.stopIds.length > 0) {
    const features = await fetchCensusIntersection({
      client,
      geoDatasetName: config.geoDatasetName,
      geoDatasetLayer: config.layer,
      tableDatasetName: config.tableDatasetName,
      tableNames: REQUIRED_ACS_TABLES,
      stopIds: config.stopIds,
      stopBufferRadius: config.radius,
    })
    const geographies: BufferGeographyIntersection[] = features
      .filter(f => (f.properties.geometry_area ?? 0) > 0)
      .map(f => ({
        geoid: f.properties.geoid,
        layer: f.properties.layer_name || config.layer,
        geometryArea: f.properties.geometry_area,
        intersectionArea: f.properties.intersection_area,
        values: f.properties.values,
      }))
    console.log(`[AggregationBuffer] union over ${config.stopIds.length} stops → ${geographies.length} geographies`)
    bufferProgressCompleted += 1
    emit({
      isLoading: true,
      currentStage: 'aggregation-buffer-geographies',
      bufferProgress: bufferProgress(),
      partialData: { aggregationBufferGeographies: geographies },
    })
  }
}
