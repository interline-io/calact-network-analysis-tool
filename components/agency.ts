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
    [key: string]: any
    marked: boolean
  }
  
  export type AgencyCsv = AgencyGtfs & AgencyDerived
  
  export type Agency = AgencyGql & AgencyDerived
  