// Census dataset layers + the geographies selected by the current geographyIds,
// derived from `geographyLayerQuery`. Owned by tne.vue (the container): tne.vue
// calls this and passes `censusGeographyLayerOptions` / `censusGeographiesSelected`
// down to child components as plain props, per the "State ownership & data flow"
// convention in CLAUDE.md (Apollo access stays in the container, not in leaves).

import { computed, type ComputedRef } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { geographyLayerQuery, type CensusDataset, type CensusGeography } from '~~/src/tl'
import { useScenarioInputs } from '~/composables/useScenarioInputs'

export interface CensusGeographyLayerOption {
  label: string
  value: string
}

export interface UseCensusGeographyLayersReturn {
  censusGeographyLayerOptions: ComputedRef<CensusGeographyLayerOption[]>
  censusGeographiesSelected: ComputedRef<CensusGeography[]>
}

const CENSUS_LAYER_DISPLAY_NAMES: Record<string, string> = {
  place: 'City / Place',
  county: 'County',
  state: 'State',
  tract: 'Census Tract',
  bg: 'Block Group',
  blockgroup: 'Block Group',
  tabblock20: 'Census Block (2020)',
  county_subdivision: 'County Subdivision',
  urban_area: 'Urban Area',
  uac20: 'Urban Area (2020)',
  cbsa: 'Core-Based Statistical Area (CBSA)',
  csa: 'Combined Statistical Area (CSA)',
  zip: 'ZIP Code (ZCTA)',
  zcta: 'ZIP Code (ZCTA)',
  zcta520: 'ZIP Code (ZCTA, 2020)',
  cd: 'Congressional District',
  cd119: 'Congressional District (119th)',
  congressional_district: 'Congressional District',
  sldu: 'State Legislative District (Upper)',
  sldl: 'State Legislative District (Lower)',
}

function formatCensusLayerLabel (_dsName: string, layerName: string): string {
  // Use human-readable name when known; otherwise strip "Layer: " prefix and title-case
  return CENSUS_LAYER_DISPLAY_NAMES[layerName]
    ?? layerName.replace(/^layer:\s*/i, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export function useCensusGeographyLayers (): UseCensusGeographyLayersReturn {
  const { geoDatasetName, geographyIds } = useScenarioInputs()

  const { result } = useQuery<{ census_datasets: CensusDataset[] }>(
    geographyLayerQuery,
    () => ({
      dataset_name: geoDatasetName.value,
      geography_ids: geographyIds.value,
      include_geographies: geographyIds.value.length > 0,
    })
  )

  const censusGeographyLayerOptions = computed<CensusGeographyLayerOption[]>(() => {
    const options: CensusGeographyLayerOption[] = []
    for (const ds of result.value?.census_datasets || []) {
      for (const layer of ds.layers || []) {
        options.push({ value: layer.name, label: formatCensusLayerLabel(ds.name, layer.name) })
      }
    }
    return options
  })

  const censusGeographiesSelected = computed<CensusGeography[]>(() => {
    const ret: CensusGeography[] = []
    for (const ds of result.value?.census_datasets || []) {
      for (const geo of ds.geographies || []) {
        ret.push(geo)
      }
    }
    return ret
  })

  return { censusGeographyLayerOptions, censusGeographiesSelected }
}
