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
  }
  
  export type AgencyGql = {
    id: number
  } & AgencyGtfs
  
  export interface AgencyDerived {
    marked: boolean
    number_routes: number
    number_stops: number
  }
  
  export type AgencyCsv = AgencyGtfs & { 
    id: number
    marked: boolean
    number_routes: number
    number_stops: number
  }
  
  export type Agency = AgencyGql & AgencyDerived
  
  // export function agencyToAgencyCsv(agency: Agency): AgencyCsv {
  //     return {
  //       marked: agency.marked,
  //       number_routes: agency.routes.size,
  //       number_stops: agency.stops.size,
  //       // GTFS properties
  //       id: agency.id,
  //       agency_id: agency.agency_id,
  //       agency_name: agency.name,
  //       agency_email: agency.agency_email,
  //       agency_fare_url: agency.agency_fare_url,
  //       agency_lang: agency.agency_lang,
  //       agency_phone: agency.agency_phone,
  //       agency_timezone: agency.agency_timezone,
  //     }
  // }