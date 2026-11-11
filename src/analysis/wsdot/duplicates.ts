// The duplicate route collapse for the WSDOT reports: a copy of a route kept
// from another feed leaves the routes, and the stops only copies serve leave
// the stops, by the browse's rules (src/scenario/duplicate-routes.ts). The
// report applies no browse filters, so every route counts as passing them:
// under a browse agency filter, the browse can keep a different copy than the
// report does.
//
// The copies are found once the routes are in and before departures start
// (ScenarioFetcherOpts.excludeDepartureRoutes), so their departures are never
// fetched and never reach the report's per-stop counts.

import { collapsedRouteSummaries, findDuplicateRoutes, type CollapsedRouteSummary } from '~~/src/scenario'
import type { RouteGql } from '~~/src/tl'

export interface WSDOTDuplicateRoutes {
  // The copies, by route id.
  hidden: ReadonlySet<number>
  // The stops only copies serve.
  removedStopIds: number[]
  // The copies, as the browse lists them.
  collapsedRoutes: CollapsedRouteSummary[]
}

const NONE: WSDOTDuplicateRoutes = { hidden: new Set(), removedStopIds: [], collapsedRoutes: [] }

/**
 * Find the copies among the routes, and the stops only they serve, from the
 * stops phase's route id -> stop ids.
 */
export function findWsdotDuplicateRoutes (routes: RouteGql[], routeStopIds: Record<number, number[]>): WSDOTDuplicateRoutes {
  const collapsed = findDuplicateRoutes(routes, () => true)
  if (collapsed.size === 0) {
    return NONE
  }
  const hidden = new Set(collapsed.keys())
  const copyStops = new Set<number>()
  for (const routeId of hidden) {
    for (const stopId of routeStopIds[routeId] ?? []) {
      copyStops.add(stopId)
    }
  }
  const shared = new Set<number>()
  for (const [routeId, stopIds] of Object.entries(routeStopIds)) {
    if (!hidden.has(Number(routeId))) {
      for (const stopId of stopIds) {
        if (copyStops.has(stopId)) {
          shared.add(stopId)
        }
      }
    }
  }
  return {
    hidden,
    removedStopIds: [...copyStops].filter(id => !shared.has(id)),
    collapsedRoutes: collapsedRouteSummaries(routes, collapsed),
  }
}
