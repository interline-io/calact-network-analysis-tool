// Buffer-only passes for issue #315 — extracted from scenario.ts so the
// main pipeline file stays focused on the scenario fetcher and stream wiring.
//
// `runBufferPasses` is the shared implementation behind two callers:
//   - `ScenarioFetcher.fetchBufferData()` inside the main scenario pipeline.
//   - `streamBufferGeographies()` in scenario.ts, which the
//     `/api/buffer-geographies` endpoint uses to refetch only the buffer
//     state when the user changes radius or layer without re-running the
//     full scenario.

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

// Per-request batch sizes for the route / agency buffer passes (#315 D, E).
// Smaller than the stop batch because each entity expands to its full stop
// set server-side, multiplying the cost of a single request.
const BUFFER_ENTITY_BATCH_SIZE = 50

// Wire-stage + partialData key for each buffer entity kind. Centralized so
// the per-kind buffer-fetch loop only needs the kind to know what to emit.
const BUFFER_PASS_BY_KIND = {
  stops: { stage: 'stop-buffer-geographies', partialKey: 'stopBufferGeographies' },
  routes: { stage: 'route-buffer-geographies', partialKey: 'routeBufferGeographies' },
  agencies: { stage: 'agency-buffer-geographies', partialKey: 'agencyBufferGeographies' },
} as const

// Inputs for the buffer-only fetch (#315 Passes C/D/E/F). Used both inline
// during the main scenario pipeline and standalone via the buffer-refetch
// endpoint when the user changes radius or layer.
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

// Shared implementation for Passes C / D / E / F. Pure with respect to its
// inputs; emits ScenarioProgress events through `emit`. Callers wrap this
// with a sender (stream) or accumulator (in-process).
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
  for (const { kind, ids, batchSize } of passes) {
    const { stage, partialKey } = BUFFER_PASS_BY_KIND[kind]
    for (const chunk of chunkArray(ids, batchSize)) {
      const results = await fetchEntityBufferGeographies(kind, { ...baseConfig, ids: chunk })
      emit({ isLoading: true, currentStage: stage, partialData: { [partialKey]: results } })
    }
  }

  // Pass F — single union query through fetchCensusIntersection.
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
    emit({
      isLoading: true,
      currentStage: 'aggregation-buffer-geographies',
      partialData: { aggregationBufferGeographies: geographies },
    })
  }
}
