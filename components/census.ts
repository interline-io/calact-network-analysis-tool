import { gql } from 'graphql-tag'
import { type Geometry } from '../components/geom'

export const geographyLayerQuery = gql`
query($geography_ids: [Int!], $include_geographies: Boolean = false) {
  census_datasets {
    id
    name
    description
    geographies(where:{ids: $geography_ids}) @include(if: $include_geographies) {
      id
      geoid
      name
      geometry
      adm1_name
      adm1_iso
      geometry
    }
    layers {
      id
      name
      description
    }
  }
}`

export const geographySearchQuery = gql`
query($search: String, $layer: String, $focus: FocusPoint, $limit: Int){
  census_datasets {
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
