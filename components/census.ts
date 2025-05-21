import { gql } from 'graphql-tag'
import { type Geometry } from '../components/geom'

export const geographyQuery = gql`
query($dataset_name: String, $search: String, $layer: String, $focus: FocusPoint, $limit: Int){
  census_datasets(where:{dataset_name:$dataset_name}) {
    dataset_name
    layers
    geographies(limit: $limit, where:{layer:$layer, search:$search, location:{focus:$focus}}) {
      id
      geoid
      layer_name
      name
      geometry
      adm1_name
      adm1_iso
    }
  }
}`

export interface CensusDataset {
    dataset_name: string
    layers: string[]
    geographies: CensusGeography[]
  }
  
export interface CensusGeography {
  id: number
  geoid: string
  layer_name: string
  name: string
  geometry: Geometry
  adm1_name: string
  adm1_iso: string
}
