// Buffer-only passes for #315. Shared by `ScenarioFetcher.fetchBufferData()`
// (inline pipeline) and `streamBufferGeographies()` (the standalone refetch
// endpoint that fires when the user changes radius/layer).

import {
  type GraphQLClient,
  chunkArray,
  TaskQueue,
  REQUIRED_ACS_TABLES,
} from '~~/src/core'
import {
  fetchCensusIntersection,
  fetchEntityBufferGeographies,
  type BufferEntityKind,
  type BufferGeographyIntersection,
} from '~~/src/tl'
import type { ScenarioProgress } from './scenario'
import { PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type PhaseOpts } from './phases/common'

// One route/agency per request. The server resolves these kinds an entity at a
// time — a batch of N is N sequential queries inside one request — so batching
// buys nothing but a longer request. Concurrency comes from the queue instead.
const BUFFER_ENTITY_BATCH_SIZE = 1

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
  // Default 1 — matches BUFFER_ENTITY_BATCH_SIZE.
  entityChunkSize?: number
}

// Pure over its inputs; callers wrap `emit` with either a stream sender or
// an in-process accumulator.
export async function runBufferPasses (
  config: BufferFetchConfig,
  client: GraphQLClient,
  emit: (progress: ScenarioProgress) => void,
  opts: PhaseOpts = {},
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

  // All four passes report as one 'buffers' progress slice; chunk counts are
  // known upfront (+1 for the aggregation union when it will run).
  const totalChunks = passes.reduce((acc, p) => acc + Math.ceil(p.ids.length / p.batchSize), 0)
    + (config.stopIds.length > 0 ? 1 : 0)
  let completedChunks = 0
  if (totalChunks === 0) {
    emit({ isLoading: true, currentStage: 'stop-buffer-geographies', phaseProgress: phaseDone('buffers') })
    return
  }

  // A queue per kind rather than one over all three, so the stage a chunk
  // reports stays stable for the duration of its pass.
  for (const { kind, ids, batchSize } of passes) {
    const chunks = chunkArray(ids, batchSize)
    if (chunks.length === 0) {
      continue
    }
    const { stage, partialKey } = BUFFER_PASS_BY_KIND[kind]
    let completedInPass = 0
    const progressEvent = (): ScenarioProgress => ({
      isLoading: true,
      currentStage: stage,
      phaseProgress: { phase: 'buffers', completed: completedChunks + completedInPass, total: totalChunks },
    })
    const queue = new TaskQueue<number[]>(
      PHASE_MAX_CONCURRENT_REQUESTS,
      async (chunk) => {
        const results = await fetchEntityBufferGeographies(kind, { ...baseConfig, ids: chunk })
        await emit({ ...progressEvent(), partialData: { [partialKey]: results } })
      },
      {
        onProgress: (completed) => {
          completedInPass = completed
          emit(progressEvent())
        },
        onError: error => opts.onError?.(error),
      },
    )
    queue.enqueue(chunks)
    await queue.run()
    completedChunks += chunks.length
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
        // Carried so the aggregation table can seed a named row for a
        // geography only the buffer reaches.
        name: f.properties.name,
        geometryArea: f.properties.geometry_area,
        intersectionArea: f.properties.intersection_area,
        values: f.properties.values,
      }))
    console.log(`[AggregationBuffer] union over ${config.stopIds.length} stops → ${geographies.length} geographies`)
    completedChunks += 1
    await emit({
      isLoading: true,
      currentStage: 'aggregation-buffer-geographies',
      partialData: { aggregationBufferGeographies: geographies },
      phaseProgress: { phase: 'buffers', completed: completedChunks, total: totalChunks },
    })
  }
}
