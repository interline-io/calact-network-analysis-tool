// Fares phase: a standard-fare summary for each route in the scenario, from
// the feed versions' GTFS Fares v1 and v2 tables (#454). Needs only the route
// and stop ids from the stops phase, so it runs alongside departures.
//
// The summary is derived here rather than on the client: the fare tables of a
// regional feed run to tens of thousands of rows, while the summaries are a
// few fields per route.

import { chunkArray, fmtDate, type GraphQLClient } from '~~/src/core'
import {
  FARE_TABLE_LIMIT,
  deriveRouteFareSummary,
  dropInactiveTimeframeRules,
  fareRoutesQuery,
  fareRouteFromGql,
  fareStopsQuery,
  feedFaresFromGql,
  feedFaresUseStops,
  feedVersionFaresQuery,
  type FareRouteGql,
  type FareStopGql,
  type FeedVersionFaresGql,
  type RouteFareSummary,
} from '~~/src/tl'
import { getSelectedDateRange, phaseQueue, type FeedVersionRef, type PhaseEmit, type PhaseOpts } from './common'

// Ids per route/stop lookup; the server's maximum page size.
const FARE_ID_BATCH_SIZE = 1000

export interface FaresPhaseConfig {
  feedVersions: FeedVersionRef[]
  // Feed version sha1 -> the scenario's route ids in it.
  feedVersionRouteIds: Record<string, number[]>
  // Route id -> the scenario's stops on that route.
  routeStopIds: Record<number, number[]>
  // The scenario's date range. A time-limited fare (a fare_leg_rules
  // timeframe) counts only if its service runs on one of these dates.
  startDate?: Date
  endDate?: Date
}

export async function runFaresPhase (
  config: FaresPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const { queue, progressEvent, done } = phaseQueue<FeedVersionRef>('fares', emit, fv => fetchFeedVersionFares(fv), opts)
  // Without a date range every timeframe counts.
  const dates = config.startDate || config.endDate ? getSelectedDateRange(config).map(d => fmtDate(d)) : []

  async function fetchFeedVersionFares (fv: FeedVersionRef): Promise<void> {
    const routeIds = config.feedVersionRouteIds[fv.feedVersionSha1] || []
    if (routeIds.length === 0) {
      return
    }
    const response = await client.query<{ feed_versions: FeedVersionFaresGql[] }>(feedVersionFaresQuery, {
      sha1: fv.feedVersionSha1,
      limit: FARE_TABLE_LIMIT,
    })
    const fvData = response.data?.feed_versions?.[0]
    if (!fvData) {
      return
    }
    const fares = dropInactiveTimeframeRules(feedFaresFromGql(fvData), dates)

    // A feed version with no fares needs no route or stop lookups.
    if (fares.legRules.length === 0 && !fares.droppedLegRules && fares.fareAttributes.length === 0) {
      const none: RouteFareSummary = { source: 'none', flags: [] }
      await emit({ ...progressEvent(), partialData: { routeFares: routeIds.map(id => [id, none]) } })
      return
    }

    const routes: FareRouteGql[] = []
    for (const ids of chunkArray(routeIds, FARE_ID_BATCH_SIZE)) {
      const r = await client.query<{ routes: FareRouteGql[] }>(fareRoutesQuery, { ids, limit: FARE_ID_BATCH_SIZE })
      routes.push(...(r.data?.routes || []))
    }

    const stopsById = new Map<number, FareStopGql>()
    if (feedFaresUseStops(fares)) {
      const stopIds = [...new Set(routeIds.flatMap(id => config.routeStopIds[id] || []))]
      for (const ids of chunkArray(stopIds, FARE_ID_BATCH_SIZE)) {
        const r = await client.query<{ stops: FareStopGql[] }>(fareStopsQuery, { ids, limit: FARE_ID_BATCH_SIZE })
        for (const stop of r.data?.stops || []) {
          stopsById.set(stop.id, stop)
        }
      }
    }

    const routeFares: [number, RouteFareSummary][] = routes.map((route) => {
      const stops = (config.routeStopIds[route.id] || [])
        .map(id => stopsById.get(id))
        .filter((s): s is FareStopGql => s != null)
      return [route.id, deriveRouteFareSummary(fares, fareRouteFromGql(route, stops))]
    })
    console.log(`[Fares] ${routeFares.length} route fare summaries from ${fv.feedOnestopId}`)
    await emit({ ...progressEvent(), partialData: { routeFares } })
  }

  for (const fv of config.feedVersions) {
    queue.enqueueOne(fv)
  }
  await queue.run()
  done()
}
