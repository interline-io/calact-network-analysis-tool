import type { ScenarioConfig } from '~/src/scenario/scenario'

export interface WSDOTStopsRoutesReport {
  stops: WSDOTStopResult[]
  routes: WSDOTRouteResult[]
  agencies: WSDOTAgencyResult[]
}

export interface WSDOTStopResult {
  // GTFS stop fields (using existing camelCase convention)
  stopId: string
  stopCode: string | null
  platformCode: string | null
  stopName: string
  stopDesc: string | null
  stopLat: number
  stopLon: number
  zoneId: string | null
  stopUrl: string | null
  locationType: number
  parentStation: string | null
  wheelchairBoarding: number
  ttsStopName: string | null
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
  routeShortName: string | null
  routeLongName: string | null
  routeDesc: string | null
  routeType: number
  routeUrl: string | null
  routeColor: string | null
  routeTextColor: string | null
  routeSortOrder: number | null
  continuousPickup: number | null
  continuousDropOff: number | null

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

export type WSDOTStopsRoutesReportConfig = ScenarioConfig
