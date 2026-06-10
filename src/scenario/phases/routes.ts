// Phase 3: fetch route details for the route ids discovered by the stops
// phase. Returns the agency ids the buffer passes roll up to.

import { chunkArray, TaskQueue, type GraphQLClient } from '~~/src/core'
import { routeQuery, type RouteGql } from '~~/src/tl'
import { PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type PhaseEmit, type PhaseOpts } from './common'
import type { ScenarioProgress } from '../scenario'

// Emission batch size for streamed routes.
const PROGRESS_LIMIT_ROUTES = 10

// Route ids per GraphQL request.
const ROUTE_FETCH_BATCH_SIZE = 100

export interface RoutesPhaseConfig {
  routeIds: number[]
  batchSize?: number
}

export interface RoutesPhaseResult {
  agencyIds: number[]
}

export async function runRoutesPhase (
  config: RoutesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<RoutesPhaseResult> {
  const agencyIds: Set<number> = new Set()

  const queue: TaskQueue<number[]> = new TaskQueue<number[]>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    ids => fetchRouteBatch(ids),
    {
      onProgress: () => { emit(progressEvent()) },
      onError: error => opts.onError?.(error),
    }
  )

  function progressEvent (): ScenarioProgress {
    const p = queue.getProgress()
    return {
      isLoading: true,
      currentStage: 'routes',
      feedVersionProgress: p,
      phaseProgress: { phase: 'routes', completed: p.completed, total: p.total },
    }
  }

  async function fetchRouteBatch (ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return
    }
    const response = await client.query<{ routes: RouteGql[] }>(routeQuery, { ids })
    const routeData = response.data?.routes || []

    // Send progress updates in batches using the generic helper function
    for (const routeBatch of chunkArray(routeData, PROGRESS_LIMIT_ROUTES)) {
      emit({ ...progressEvent(), partialData: { routes: routeBatch } })
    }

    for (const r of routeData) {
      const aid = r.agency?.id
      if (aid != null) {
        agencyIds.add(aid)
      }
    }

    console.log(`Fetched ${routeData.length} routes`)
  }

  for (const chunk of chunkArray(config.routeIds, config.batchSize ?? ROUTE_FETCH_BATCH_SIZE)) {
    queue.enqueueOne(chunk)
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('routes') })

  return { agencyIds: [...agencyIds] }
}
