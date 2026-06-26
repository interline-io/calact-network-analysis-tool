import { gql } from 'graphql-tag'
import type { Geometry, CensusValues } from '~~/src/core'

// ACS "jam values": negative sentinels the Census Bureau publishes in place
// of an estimate when the value is unavailable, not applicable, or suppressed
// for sample size. Drop them so derivations + the UI see missing data and
// render "—" instead of surfacing e.g. -$666,666,666 as median income.
// Authoritative list: 2024_Jam_Values.xlsx on
// census.gov/programs-surveys/acs/technical-documentation/code-lists.html.
// (MoE-only jam values like -222222222 are intentionally omitted — we read
// estimate fields, not MoE.)
export const ACS_JAM_VALUES = new Set<number>([
  -666666666, -888888888, -999999999,
])

// Flatten the backend's per-(geography, table) value rows into one keyed map,
// keeping only the requested table dataset and dropping ACS jam values. Shared
// by the census-intersection and stop-buffer fetchers.
export function parseAcsValues (
  rows: { dataset_name: string, values: Record<string, number> }[] | undefined,
  tableDataset: string,
): CensusValues {
  const values: CensusValues = {}
  for (const row of rows || []) {
    if (row.dataset_name !== tableDataset) {
      continue
    }
    for (const [k, v] of Object.entries(row.values || {})) {
      if (typeof v === 'number' && Number.isFinite(v) && !ACS_JAM_VALUES.has(v)) {
        values[k] = v
      }
    }
  }
  return values
}

export const geographyLayerQuery = gql`
query($geography_ids: [Int!], $include_geographies: Boolean = false, $dataset_name: String) {
  census_datasets(where: {name: $dataset_name}) {
    id
    name
    description
    geographies(limit: 100000, where:{ids: $geography_ids}) @include(if: $include_geographies) {
      id
      geoid
      name
      geometry
      adm1_name
      adm1_iso
      layer {
        id
        name
        description
      }      
    }
    layers {
      id
      name
      description
    }
  }
}`

export const geographySearchQuery = gql`
query($search: String, $layer: String, $focus: FocusPoint, $limit: Int, $dataset_name: String){
  census_datasets(where: {name: $dataset_name}) {
    id
    name
    description
    geographies(limit: $limit, where:{layer:$layer, search:$search, location:{focus:$focus}}) {
      id
      geoid
      name
      geometry
      adm1_name
      adm1_iso
      layer {
        id
        name
        description
      }
    }
  }
}`

export const geographyBboxQuery = gql`
query($layer: String, $limit: Int, $dataset_name: String, $bbox: BoundingBox){
  census_datasets(where: {name: $dataset_name}) {
    id
    name
    description
    geographies(limit: $limit, where:{layer:$layer, location:{bbox:$bbox}}) {
      id
      geoid
      name
      geometry
      adm1_name
      adm1_iso
      layer {
        id
        name
        description
      }
    }
  }
}`

export const censusDatasetListQuery = gql`
query {
  census_datasets {
    id
    name
    description
  }
}`

export interface CensusDataset {
  id: number
  name: string
  description: string
  layers: CensusLayer[]
  geographies: CensusGeography[]
}

export interface CensusLayer {
  id: number
  name: string
  description: string
}

export interface CensusGeography {
  id: number
  geoid: string
  layer: CensusLayer
  name: string
  geometry: Geometry
  adm1_name: string
  adm1_iso: string
  //////
  dataset_name: string
  dataset_description: string
}
