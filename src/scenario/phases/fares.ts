// Fares phase: a standard-fare summary for each route in the scenario, from
// the feed versions' GTFS Fares v1 and v2 tables (#454). Needs only the route
// and stop ids from the stops phase, so it runs alongside departures.
//
// The summary is derived here rather than on the client: the fare tables of a
// regional feed run to tens of thousands of rows, while the summaries are a
// few fields per route.

import type { DocumentNode } from 'graphql'
import { chunkArray, type GraphQLClient } from '~~/src/core'
import {
  FARE_TABLE_LIMIT,
  NO_FARES_SUMMARY,
  deriveRouteFareSummary,
  dropInactiveTimeframeRules,
  fareRoutesQuery,
  fareRouteFromGql,
  fareStopFromGql,
  fareStopsQuery,
  feedFaresFromGql,
  feedFaresUseStops,
  feedVersionFaresQuery,
  type FareRouteGql,
  type FareStop,
  type FareStopGql,
  type FeedFares,
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
  const dates = config.startDate || config.endDate ? getSelectedDateRange(config) : []

  // Kept separate so only the flattened tables outlive the request; the raw
  // response of a regional feed is several MB.
  async function fetchFeedFares (sha1: string): Promise<FeedFares | undefined> {
    const response = await client.query<{ feed_versions: FeedVersionFaresGql[] }>(feedVersionFaresQuery, {
      sha1,
      limit: FARE_TABLE_LIMIT,
    })
    const fvData = response.data?.feed_versions?.[0]
    return fvData ? dropInactiveTimeframeRules(feedFaresFromGql(fvData), dates) : undefined
  }

  // Each id batch in its own request, all at once: a feed version needs only
  // a few, and the phase queue already bounds feed versions in flight.
  async function fetchByIds<T> (query: DocumentNode, field: 'routes' | 'stops', ids: number[]): Promise<T[]> {
    const pages = await Promise.all(chunkArray(ids, FARE_ID_BATCH_SIZE).map(batch =>
      client.query<Record<string, T[]>>(query, { ids: batch, limit: FARE_ID_BATCH_SIZE })))
    return pages.flatMap(r => r.data?.[field] || [])
  }

  async function fetchFeedVersionFares (fv: FeedVersionRef): Promise<void> {
    const routeIds = config.feedVersionRouteIds[fv.feedVersionSha1] || []
    if (routeIds.length === 0) {
      return
    }
    const fares = await fetchFeedFares(fv.feedVersionSha1)
    if (!fares) {
      return
    }

    // A feed version with no fares needs no route or stop lookups.
    if (!fares.hasV1 && !fares.hasV2) {
      await emit({ ...progressEvent(), partialData: { routeFares: routeIds.map(id => [id, { ...NO_FARES_SUMMARY, flags: [] }]) } })
      return
    }

    const stopIds = feedFaresUseStops(fares)
      ? [...new Set(routeIds.flatMap(id => config.routeStopIds[id] || []))]
      : []
    const [routes, stops] = await Promise.all([
      fetchByIds<FareRouteGql>(fareRoutesQuery, 'routes', routeIds),
      fetchByIds<FareStopGql>(fareStopsQuery, 'stops', stopIds),
    ])
    // Converted once; a stop served by several routes is shared.
    const stopsById = new Map(stops.map(stop => [stop.id, fareStopFromGql(stop)]))

    const routeFares: [number, RouteFareSummary][] = routes.map((route) => {
      const routeStops = (config.routeStopIds[route.id] || [])
        .map(id => stopsById.get(id))
        .filter((s): s is FareStop => s != null)
      return [route.id, deriveRouteFareSummary(fares, fareRouteFromGql(route, routeStops))]
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
