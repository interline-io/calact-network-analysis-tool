import { apportionBuffer } from '~~/src/core'
import type { BufferGeographyIntersection } from './stop-buffer'

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

// Marked routes per fare category, and the fare range across them (#454).
export interface AgencyFareRollup {
  fare_free_routes: number
  fare_sometimes_paid_routes: number
  fare_always_paid_routes: number
  fare_unknown_routes: number
  fare_min?: number
  fare_max?: number
}

export interface AgencyDerived extends AgencyFareRollup {
  marked: boolean
  routes_count: number
  routes_modes: string
  stops_count: number
}

export type AgencyCsv = AgencyGtfs & AgencyFareRollup & {
  id: number
  marked: boolean
  routes_count: number
  routes_modes: string
  stops_count: number
}

export type Agency = AgencyGql & AgencyDerived

export function agencyToAgencyCsv (agency: Agency, bufferGeographies?: BufferGeographyIntersection[]): AgencyCsv {
  const row: AgencyCsv = {
    marked: agency.marked,
    routes_count: agency.routes_count,
    routes_modes: agency.routes_modes,
    stops_count: agency.stops_count,
    fare_free_routes: agency.fare_free_routes,
    fare_sometimes_paid_routes: agency.fare_sometimes_paid_routes,
    fare_always_paid_routes: agency.fare_always_paid_routes,
    fare_unknown_routes: agency.fare_unknown_routes,
    fare_min: agency.fare_min,
    fare_max: agency.fare_max,
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
  return bufferGeographies?.length
    ? { ...row, ...apportionBuffer(bufferGeographies).values }
    : row
}
