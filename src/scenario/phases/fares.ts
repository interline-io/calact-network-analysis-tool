// Fares phase: a standard-fare summary for each route in the scenario, from
// the feed versions' GTFS Fares v1 and v2 tables (#454). Fixed routes need
// only the stops phase, so their fares load alongside departures; the routes
// serving flex areas follow once the flex phase has found them.
//
// The summary is derived here rather than on the client: the fare tables of a
// regional feed run to tens of thousands of rows, while the summaries are a
// few fields per route.

import type { DocumentNode } from 'graphql'
import { chunkArray, type GraphQLClient } from '~~/src/core'
import {
  FARE_TABLE_LIMIT,
  deriveRouteFareSummary,
  markInactiveTimeframeRules,
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

export interface FaresPhaseOpts extends PhaseOpts {
  // More route ids that arrive while the phase runs (the routes serving flex
  // areas), by feed version. Not part of the config, which must stay
  // JSON-serializable for the standalone endpoint.
  laterRouteIds?: Promise<Record<string, number[]>>
}

// One batch of routes to price: a feed version's fixed routes, or the routes
// serving its flex areas once they are known.
interface FareTask {
  fv: FeedVersionRef
  later: boolean
}

export async function runFaresPhase (
  config: FaresPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: FaresPhaseOpts = {},
): Promise<void> {
  const { queue, progressEvent, done } = phaseQueue<FareTask>('fares', emit, task => runTask(task), opts)
  // Without a date range every timeframe counts.
  const dates = config.startDate || config.endDate ? getSelectedDateRange(config) : []

  // A feed version's fare tables, shared by its two tasks and released by the
  // later one. Only the flattened tables are kept; the raw response of a
  // regional feed is several MB.
  const faresBySha1 = new Map<string, Promise<FeedFares | undefined>>()
  function feedFares (sha1: string): Promise<FeedFares | undefined> {
    let fares = faresBySha1.get(sha1)
    if (!fares) {
      fares = client.query<{ feed_versions: FeedVersionFaresGql[] }>(feedVersionFaresQuery, { sha1, limit: FARE_TABLE_LIMIT })
        .then((response) => {
          const fvData = response.data?.feed_versions?.[0]
          return fvData ? markInactiveTimeframeRules(feedFaresFromGql(fvData), dates) : undefined
        })
      faresBySha1.set(sha1, fares)
    }
    return fares
  }

  // Each id batch in its own request, all at once: a feed version needs only
  // a few, and the phase queue already bounds feed versions in flight.
  async function fetchByIds<T> (query: DocumentNode, field: 'routes' | 'stops', ids: number[]): Promise<T[]> {
    const pages = await Promise.all(chunkArray(ids, FARE_ID_BATCH_SIZE).map(batch =>
      client.query<Record<string, T[]>>(query, { ids: batch, limit: FARE_ID_BATCH_SIZE })))
    return pages.flatMap(r => r.data?.[field] || [])
  }

  async function runTask ({ fv, later }: FareTask): Promise<void> {
    const sha1 = fv.feedVersionSha1
    try {
      const fixedIds = config.feedVersionRouteIds[sha1] || []
      let routeIds = fixedIds
      if (later) {
        const fixed = new Set(fixedIds)
        routeIds = ((await opts.laterRouteIds)?.[sha1] || []).filter(id => !fixed.has(id))
      }
      if (routeIds.length === 0) {
        return
      }
      const summaries = await priceRoutes(sha1, routeIds)
      console.log(`[Fares] ${summaries.length} route fare summaries from ${fv.feedOnestopId}`)
      await emit({ ...progressEvent(), partialData: { routeFares: summaries } })
    } finally {
      // The fixed task started first, so it already holds the tables it needs.
      if (later) {
        faresBySha1.delete(sha1)
      }
    }
  }

  // A summary for every requested id, so none is left "not loaded" for good:
  // an id the lookups leave out gets an unknown fare that says so.
  async function priceRoutes (sha1: string, routeIds: number[]): Promise<[number, RouteFareSummary][]> {
    const unavailable = (id: number): [number, RouteFareSummary] => [id, { source: 'none', flags: ['fare-data-unavailable'] }]
    const fares = await feedFares(sha1)
    if (!fares) {
      return routeIds.map(unavailable)
    }
    // A feed version with no fares needs no route or stop lookups.
    if (!fares.hasV1 && !fares.hasV2) {
      return routeIds.map(id => [id, { source: 'none', flags: [] }])
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
    const routesById = new Map(routes.map(route => [route.id, route]))

    return routeIds.map((id) => {
      const route = routesById.get(id)
      if (!route) {
        return unavailable(id)
      }
      const routeStops = (config.routeStopIds[id] || [])
        .map(stopId => stopsById.get(stopId))
        .filter((s): s is FareStop => s != null)
      return [id, deriveRouteFareSummary(fares, fareRouteFromGql(route, routeStops))]
    })
  }

  // Fixed-route tasks first, so they take the queue's slots before the later
  // tasks start waiting for their route ids.
  for (const fv of config.feedVersions) {
    queue.enqueueOne({ fv, later: false })
  }
  if (opts.laterRouteIds) {
    for (const fv of config.feedVersions) {
      queue.enqueueOne({ fv, later: true })
    }
  }
  await queue.run()
  done()
}
