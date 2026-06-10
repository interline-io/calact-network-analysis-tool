// Phase 2: fetch stops for a set of feed versions. Returns the stop ids and
// (via each stop's route_stops) the route ids that gate the downstream
// routes/departures/buffer phases.

import { convertBbox, chunkArray, TaskQueue, type Bbox, type GraphQLClient } from '~~/src/core'
import { stopQuery, type StopGql } from '~~/src/tl'
import { PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type FeedVersionRef, type PhaseEmit, type PhaseOpts } from './common'
import type { ScenarioProgress } from '../scenario'

// Emission batch size for streamed stops.
const PROGRESS_LIMIT_STOPS = 1000

export interface StopsPhaseConfig {
  feedVersions: FeedVersionRef[]
  bbox?: Bbox
  geographyIds?: number[]
  geoDatasetName: string
  // GraphQL page size; pagination continues until a short page.
  stopLimit?: number
}

export interface StopsPhaseResult {
  stopIds: number[]
  routeIds: number[]
}

interface StopFetchTask {
  after: number
  feedOnestopId: string
  feedVersionSha1: string
}

export async function runStopsPhase (
  config: StopsPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<StopsPhaseResult> {
  const stopLimit = config.stopLimit ?? 1000
  const stopIds: number[] = []
  const routeIds: Set<number> = new Set()

  const queue: TaskQueue<StopFetchTask> = new TaskQueue<StopFetchTask>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    task => fetchStopPage(task),
    {
      onProgress: () => { emit(progressEvent()) },
      onError: error => opts.onError?.(error),
    }
  )

  function progressEvent (): ScenarioProgress {
    const p = queue.getProgress()
    return {
      isLoading: true,
      currentStage: 'stops',
      feedVersionProgress: p,
      phaseProgress: { phase: 'stops', completed: p.completed, total: p.total },
    }
  }

  async function fetchStopPage (task: StopFetchTask): Promise<void> {
    // If we have geography IDs, use them and no bbox
    // If we don't, use the bbox from the config
    const geoIds = config.geographyIds || []
    const b = geoIds.length > 0 ? null : convertBbox(config.bbox)
    const variables = {
      after: task.after,
      limit: stopLimit,
      dataset_name: config.geoDatasetName,
      where: {
        location_type: 0,
        feed_version_sha1: task.feedVersionSha1,
        location: {
          bbox: geoIds.length > 0 ? null : b,
          geography_ids: geoIds.length > 0 ? geoIds : null,
        }
      }
    }
    const response = await client.query<{ stops: StopGql[] }>(stopQuery, variables)
    const stopData: StopGql[] = response.data?.stops || []
    console.log(`Fetched ${stopData.length} stops from ${task.feedOnestopId}:${task.feedVersionSha1}`)

    // Send progress updates in batches using the generic helper function
    for (const stopBatch of chunkArray(stopData, PROGRESS_LIMIT_STOPS)) {
      emit({ ...progressEvent(), partialData: { stops: stopBatch } })
    }

    // Collect stop ids and (deduplicated) route ids for downstream phases
    for (const stop of stopData) {
      stopIds.push(stop.id)
      for (const rs of stop.route_stops || []) {
        if (rs.route?.id != null) {
          routeIds.add(rs.route.id)
        }
      }
    }

    // Continue fetching more stops only if we got a full batch
    // If we got fewer than the limit, we've reached the end
    const lastStopId = stopData[stopData.length - 1]?.id
    if (stopData.length >= stopLimit && lastStopId !== undefined) {
      queue.enqueueOne({
        after: lastStopId,
        feedOnestopId: task.feedOnestopId,
        feedVersionSha1: task.feedVersionSha1
      })
    }
  }

  for (const fv of config.feedVersions) {
    queue.enqueueOne({
      after: 0,
      feedOnestopId: fv.feedOnestopId,
      feedVersionSha1: fv.feedVersionSha1,
    })
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('stops') })

  return { stopIds, routeIds: [...routeIds] }
}
