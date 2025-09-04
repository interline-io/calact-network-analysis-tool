import type { ScenarioData, ScenarioConfig } from '~/src/scenario/scenario'
import type { GraphQLClient } from '~/src/graphql'
import type { Feature } from '~/src/geom'

export interface WSDOTStopsRoutesReport {
  stops: WSDOTStopResult[]
  routes: WSDOTRouteResult[]
  agencies: WSDOTAgencyResult[]
}

export interface WSDOTStopResult {
  stopId: string
  stopName: string
  stopLat: number
  stopLon: number
  agencyId: string
  feedOnestopId: string
  feedVersionSha1: string
  geometry: GeoJSON.Point
}

export interface WSDOTRouteResult {
  routeId: string
  routeShortName: string
  routeLongName: string
  routeType: number
  agencyId: string
  feedOnestopId: string
  feedVersionSha1: string
  geometry: GeoJSON.MultiLineString
}

export interface WSDOTAgencyResult {
  agencyId: string
  agencyName: string
  feedOnestopId: string
  stopsCount: number
  routesCount: number
}

export interface WSDOTStopsRoutesReportConfig extends ScenarioConfig {
  // No additional config needed for this analysis
}

export class WSDOTStopsRoutesReportFetcher {
  private config: WSDOTStopsRoutesReportConfig
  private scenarioData: ScenarioData
  private client: GraphQLClient

  constructor (
    config: WSDOTStopsRoutesReportConfig,
    data: ScenarioData,
    client: GraphQLClient,
  ) {
    this.config = config
    this.scenarioData = data
    this.client = client
  }

  async fetch (): Promise<WSDOTStopsRoutesReport> {
    console.log('Starting WSDOT stops and routes analysis...')

    // Process stops with agency_id and feed Onestop ID
    const stops: WSDOTStopResult[] = []
    for (const stop of this.scenarioData.stops) {
      if (!stop.geometry) continue

      // Extract agency_id from route_stops if available
      let agencyId = 'unknown'
      if (stop.route_stops && stop.route_stops.length > 0) {
        const firstRoute = stop.route_stops[0].route
        if (firstRoute.agency?.agency_id) {
          agencyId = firstRoute.agency.agency_id
        }
      }

      // Get feed Onestop ID and SHA1 from the stop's feed version
      const feedOnestopId = stop.feed_version?.feed?.onestop_id || 'unknown'
      const feedVersionSha1 = stop.feed_version?.sha1 || 'unknown'

      // Make agency_id unique by prefixing with feed Onestop ID
      const uniqueAgencyId = `${feedOnestopId}:${agencyId}`

      const result: WSDOTStopResult = {
        stopId: stop.stop_id,
        stopName: stop.stop_name || '',
        stopLat: stop.geometry.coordinates[1],
        stopLon: stop.geometry.coordinates[0],
        agencyId: uniqueAgencyId,
        feedOnestopId,
        feedVersionSha1,
        geometry: stop.geometry
      }
      stops.push(result)
    }

    // Process routes with agency_id and feed Onestop ID
    const routes: WSDOTRouteResult[] = []
    for (const route of this.scenarioData.routes) {
      if (!route.geometry) continue

      // Extract agency_id from route
      const agencyId = route.agency?.agency_id || 'unknown'

      // Get feed Onestop ID and SHA1 from the route's feed version
      const feedOnestopId = route.feed_version?.feed?.onestop_id || 'unknown'
      const feedVersionSha1 = route.feed_version?.sha1 || 'unknown'

      // Make agency_id unique by prefixing with feed Onestop ID
      const uniqueAgencyId = `${feedOnestopId}:${agencyId}`

      const result: WSDOTRouteResult = {
        routeId: route.route_id,
        routeShortName: route.route_short_name || '',
        routeLongName: route.route_long_name || '',
        routeType: route.route_type,
        agencyId: uniqueAgencyId,
        feedOnestopId,
        feedVersionSha1,
        geometry: route.geometry
      }
      routes.push(result)
    }

    // Process agencies with counts
    const agencyMap = new Map<string, WSDOTAgencyResult>()

    // Count stops per agency
    for (const stop of stops) {
      const existing = agencyMap.get(stop.agencyId)
      if (existing) {
        existing.stopsCount++
      } else {
        agencyMap.set(stop.agencyId, {
          agencyId: stop.agencyId,
          agencyName: stop.agencyId.split(':')[1] || 'Unknown',
          feedOnestopId: stop.feedOnestopId,
          stopsCount: 1,
          routesCount: 0
        })
      }
    }

    // Count routes per agency
    for (const route of routes) {
      const existing = agencyMap.get(route.agencyId)
      if (existing) {
        existing.routesCount++
      } else {
        agencyMap.set(route.agencyId, {
          agencyId: route.agencyId,
          agencyName: route.agencyId.split(':')[1] || 'Unknown',
          feedOnestopId: route.feedOnestopId,
          stopsCount: 0,
          routesCount: 1
        })
      }
    }

    const agencies = Array.from(agencyMap.values())

    console.log(`Processed ${stops.length} stops, ${routes.length} routes, and ${agencies.length} agencies`)

    return {
      stops,
      routes,
      agencies
    }
  }
}
