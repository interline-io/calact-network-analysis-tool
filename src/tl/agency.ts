import { apportionBuffer } from '~~/src/core'
import type { TractIntersection } from './stop-buffer'

//////////
// Agencies
//////////

export interface AgencyGtfs {
  agency_id: string
  agency_name: string
  agency_email?: string
  agency_url?: string
  agency_timezone?: string
  agency_lang?: string
  agency_phone?: string
  agency_fare_url?: string
  __typename?: string // GraphQL compatibility
}

export type AgencyGql = {
  id: number
} & AgencyGtfs

export interface AgencyDerived {
  marked: boolean
  routes_count: number
  routes_modes: string
  stops_count: number
}

export type AgencyCsv = AgencyGtfs & {
  id: number
  marked: boolean
  routes_count: number
  routes_modes: string
  stops_count: number
  // Apportioned demographic columns merged in when bufferTracts are
  // provided. Keyed by CensusColumnDef.id (e.g. total_population).
  [key: string]: string | number | boolean | null | undefined
}

export type Agency = AgencyGql & AgencyDerived

export function agencyToAgencyCsv (agency: Agency, bufferTracts?: TractIntersection[]): AgencyCsv {
  const row: AgencyCsv = {
    marked: agency.marked,
    routes_count: agency.routes_count,
    routes_modes: agency.routes_modes,
    stops_count: agency.stops_count,
    // GTFS properties
    id: agency.id,
    agency_id: agency.agency_id,
    agency_name: agency.agency_name,
    agency_email: agency.agency_email,
    agency_fare_url: agency.agency_fare_url,
    agency_lang: agency.agency_lang,
    agency_phone: agency.agency_phone,
    agency_timezone: agency.agency_timezone,
  }
  if (bufferTracts && bufferTracts.length > 0) {
    Object.assign(row, apportionBuffer(bufferTracts).values)
  }
  return row
}
