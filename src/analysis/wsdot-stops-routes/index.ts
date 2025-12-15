import type { WSDOTReport, WSDOTReportConfig } from '~~/src/analysis/wsdot'
import type { GraphQLClient } from '~~/src/core'
import type { ScenarioData } from '~~/src/scenario'

import { runAnalysis as runWsdotAnalysis } from '~~/src/analysis/wsdot'

export interface WSDOTStopsRoutesReport {
  stops: WSDOTStopResult[]
  routes: WSDOTRouteResult[]
  agencies: WSDOTAgencyResult[]
}

export interface WSDOTStopResult {
  // GTFS stop fields (using existing camelCase convention)
  stopId: string
  stopCode?: string
  platformCode?: string
  stopName: string
  stopDesc?: string
  stopLat: number
  stopLon: number
  zoneId?: string
  stopUrl?: string
  locationType: number
  parentStation?: string
  wheelchairBoarding: number
  ttsStopName?: string
  stopTimezone: string

  // Service level columns (from WSDOT analysis)
  level6: number
  level5: number
  level4: number
  level3: number
  level2: number
  level1: number
  levelNights: number

  // Additional fields for our internal use
  agencyId: string
  feedOnestopId: string
  feedVersionSha1: string
  geometry: GeoJSON.Point
}

export interface WSDOTRouteResult {
  // GTFS route fields (using existing camelCase convention)
  routeId: string
  routeShortName?: string
  routeLongName?: string
  routeDesc?: string
  routeType: number
  routeUrl?: string
  routeColor?: string
  routeTextColor?: string
  routeSortOrder?: number
  continuousPickup?: number
  continuousDropOff?: number

  // Additional fields for our internal use
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

export type WSDOTStopsRoutesReportConfig = WSDOTReportConfig

export async function runAnalysis (controller: ReadableStreamDefaultController, config: WSDOTReportConfig, client: GraphQLClient): Promise<{ scenarioData: ScenarioData, wsdotReport: WSDOTReport, stopsRoutesReport: WSDOTStopsRoutesReport }> {
  const { scenarioData, wsdotResult } = await runWsdotAnalysis(controller, config, client)
  const stopsRoutesReport = processWsdotStopsRoutesReport(scenarioData, wsdotResult)
  return { scenarioData, wsdotReport: wsdotResult, stopsRoutesReport }
}

export function processWsdotStopsRoutesReport (currentData: ScenarioData, wsdotReport: WSDOTReport): WSDOTStopsRoutesReport {
  // Convert WSDOT report to stops/routes format for the viewer
  // Build agency map to avoid duplicates and get proper names
  const agencyMap = new Map<string, { agencyId: string, agencyName: string, feedOnestopId: string, stopsCount: number, routesCount: number }>()

  // Create a lookup map for WSDOT service levels by stop ID
  const wsdotServiceLevels = new Map<string, { level6: boolean, level5: boolean, level4: boolean, level3: boolean, level2: boolean, level1: boolean, levelNights: boolean }>()
  if (wsdotReport.stops) {
    for (const wsdotStop of wsdotReport.stops) {
      wsdotServiceLevels.set(wsdotStop.stopId, {
        level6: wsdotStop.level6,
        level5: wsdotStop.level5,
        level4: wsdotStop.level4,
        level3: wsdotStop.level3,
        level2: wsdotStop.level2,
        level1: wsdotStop.level1,
        levelNights: wsdotStop.levelNights
      })
    }
  }

  // Process stops to build agency map - filter out stops with no routes
  const stops = currentData.stops
    .filter(stop => stop.route_stops && stop.route_stops.length > 0)
    .map((stop) => {
      const agencyId = stop.route_stops?.[0]?.route?.agency?.agency_id
      const agencyName = stop.route_stops?.[0]?.route?.agency?.agency_name
      const feedOnestopId = stop.feed_version?.feed?.onestop_id || 'unknown'
      const feedVersionSha1 = stop.feed_version?.sha1 || 'unknown'

      // Handle null agency_id (allowed in GTFS)
      const effectiveAgencyId = agencyId || 'null'
      const effectiveAgencyName = agencyName || (agencyId ? agencyId : 'No Agency Info')
      const uniqueAgencyId = `${feedOnestopId}:${effectiveAgencyId}`

      // Debug logging for agency extraction
      if (!agencyName && !agencyId) {
        console.log('Stop with no agency info:', {
          stopId: stop.stop_id,
          routeStops: stop.route_stops?.length || 0,
          firstRoute: stop.route_stops?.[0]?.route?.route_id,
          agency: stop.route_stops?.[0]?.route?.agency
        })
      }

      // Add to agency map
      if (!agencyMap.has(uniqueAgencyId)) {
        agencyMap.set(uniqueAgencyId, {
          agencyId: uniqueAgencyId,
          agencyName: effectiveAgencyName,
          feedOnestopId,
          stopsCount: 0,
          routesCount: 0
        })
      }
      agencyMap.get(uniqueAgencyId)!.stopsCount++

      // Look up service levels for this stop
      const serviceLevels = wsdotServiceLevels.get(stop.stop_id)

      return {
        // GTFS stop fields (using existing camelCase convention)
        stopId: stop.stop_id,
        stopCode: stop.stop_code,
        platformCode: stop.platform_code,
        stopName: stop.stop_name || '',
        stopDesc: stop.stop_desc,
        stopLon: stop.geometry?.coordinates[0] || 0,
        stopLat: stop.geometry?.coordinates[1] || 0,
        zoneId: stop.zone_id,
        stopUrl: stop.stop_url,
        locationType: stop.location_type,
        parentStation: stop.parent?.stop_id,
        wheelchairBoarding: stop.wheelchair_boarding || 0,
        ttsStopName: stop.tts_stop_name,
        stopTimezone: stop.stop_timezone || 'America/Los_Angeles', // Default timezone for WSDOT

        // Service level columns (populated from WSDOT analysis)
        level6: serviceLevels?.level6 ? 1 : 0,
        level5: serviceLevels?.level5 ? 1 : 0,
        level4: serviceLevels?.level4 ? 1 : 0,
        level3: serviceLevels?.level3 ? 1 : 0,
        level2: serviceLevels?.level2 ? 1 : 0,
        level1: serviceLevels?.level1 ? 1 : 0,
        levelNights: serviceLevels?.levelNights ? 1 : 0,

        // Additional fields for our internal use
        agencyId: uniqueAgencyId,
        feedOnestopId,
        feedVersionSha1,
        geometry: stop.geometry || { type: 'Point', coordinates: [0, 0] }
      }
    })

  // Process routes to build agency map
  const routes = currentData.routes.map((route) => {
    const agencyId = route.agency?.agency_id || null
    const agencyName = route.agency?.agency_name
    const feedOnestopId = route.feed_version?.feed?.onestop_id || 'unknown'
    const feedVersionSha1 = route.feed_version?.sha1 || 'unknown'

    // Handle null agency_id (allowed in GTFS)
    const effectiveAgencyId = agencyId || 'null'
    const effectiveAgencyName = agencyName || (agencyId ? agencyId : 'No Agency Info')
    const uniqueAgencyId = `${feedOnestopId}:${effectiveAgencyId}`

    // Debug logging for agency extraction
    if (!agencyName && !agencyId) {
      console.log('Route with no agency info:', {
        routeId: route.route_id,
        agency: route.agency
      })
    }

    // Add to agency map
    if (!agencyMap.has(uniqueAgencyId)) {
      agencyMap.set(uniqueAgencyId, {
        agencyId: uniqueAgencyId,
        agencyName: effectiveAgencyName,
        feedOnestopId,
        stopsCount: 0,
        routesCount: 0
      })
    }
    agencyMap.get(uniqueAgencyId)!.routesCount++

    return {
      // GTFS route fields (using existing camelCase convention)
      routeId: route.route_id,
      routeShortName: route.route_short_name,
      routeLongName: route.route_long_name,
      routeDesc: route.route_desc,
      routeType: route.route_type,
      routeUrl: route.route_url,
      routeColor: route.route_color,
      routeTextColor: route.route_text_color,
      routeSortOrder: route.route_sort_order,
      continuousPickup: route.continuous_pickup,
      continuousDropOff: route.continuous_drop_off,

      // Additional fields for our internal use
      agencyId: uniqueAgencyId,
      feedOnestopId,
      feedVersionSha1,
      geometry: route.geometry || { type: 'MultiLineString', coordinates: [] }
    }
  })

  // Convert agency map to array
  const agencies = Array.from(agencyMap.values())

  // Debug logging for final agency data
  console.log('Final agency data:', {
    totalAgencies: agencies.length,
    agencies: agencies.map(a => ({ id: a.agencyId, name: a.agencyName, stops: a.stopsCount, routes: a.routesCount })),
    totalStops: stops.length,
    stopsWithoutAgency: stops.filter(s => s.agencyId.includes(':null')).length,
    totalRoutes: routes.length,
    routesWithoutAgency: routes.filter(r => r.agencyId.includes(':null')).length,
    originalStopsCount: currentData.stops.length,
    filteredOutStops: currentData.stops.length - stops.length
  })

  return {
    stops,
    routes,
    agencies
  }
}
