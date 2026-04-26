import { computed, type ComputedRef, type Ref } from 'vue'
import {
  CENSUS_COLUMNS,
  buildChoroplethClassification,
  getChoroplethColor,
  pickChoroplethValue,
  type CensusFormat,
  type CensusGeographyData,
  type ChoroplethClassification,
  type Feature,
} from '~~/src/core'
import type { CensusDataset, CensusGeography } from '~~/src/tl'

interface UseChoroplethClassificationInput {
  showAggAreas: Ref<boolean> | ComputedRef<boolean>
  choroplethAggregateData: ComputedRef<Array<Record<string, unknown>>>
  choroplethElement: Ref<string> | ComputedRef<string>
  choroplethElementOptions: ComputedRef<Array<{ label: string, value: string }>>
  shadeByDensity: Ref<boolean> | ComputedRef<boolean>
  isDensityEligible: Ref<boolean> | ComputedRef<boolean>
  censusGeographies: ComputedRef<Map<string, CensusGeographyData> | undefined>
  choroplethGeoResult: Ref<{ census_datasets: CensusDataset[] } | null | undefined>
  selectedAggregationGeoid: Ref<string | null>
}

// Wires the pure choropleth math from `src/core/choropleth.ts` to Vue refs.
export function useChoroplethClassification (input: UseChoroplethClassificationInput) {
  // Memoized so classification + feature generation share one pass.
  const pickedByGeoid = computed((): Map<string, number | null> => {
    const aggData = input.choroplethAggregateData.value
    const element = input.choroplethElement.value
    const isDensity = input.shadeByDensity.value && input.isDensityEligible.value
    const geos = input.censusGeographies.value
    const out = new Map<string, number | null>()
    for (const a of aggData) {
      const row = a as Record<string, any>
      out.set(row.geoid as string, pickChoroplethValue(row, element, isDensity, geos))
    }
    return out
  })

  const choroplethClassification = computed((): ChoroplethClassification => {
    const element = input.choroplethElement.value
    const label = input.choroplethElementOptions.value.find(o => o.value === element)?.label || element
    const format: CensusFormat = CENSUS_COLUMNS.find(c => c.id === element)?.format || 'integer'
    const isDensity = input.shadeByDensity.value && input.isDensityEligible.value
    return buildChoroplethClassification({
      pickedByGeoid: pickedByGeoid.value,
      element,
      label,
      format,
      isDensity,
    })
  })

  const choroplethGeoLookup = computed((): Map<string, CensusGeography> => {
    const lookup = new Map<string, CensusGeography>()
    for (const ds of input.choroplethGeoResult.value?.census_datasets || []) {
      for (const geo of ds.geographies || []) {
        lookup.set(geo.geoid, geo)
      }
    }
    return lookup
  })

  // Feature properties carry only geoid/name + styling — the census panel
  // looks up the full row by geoid on click instead of bloating each feature.
  const choroplethFeatures = computed((): Feature[] => {
    if (!input.showAggAreas.value) { return [] }

    const aggData = input.choroplethAggregateData.value
    if (aggData.length === 0) { return [] }
    const geoLookup = choroplethGeoLookup.value
    const { palette, breaks } = choroplethClassification.value
    const picked = pickedByGeoid.value
    const selectedGeoid = input.selectedAggregationGeoid.value

    const features: Feature[] = []
    for (const agg of aggData) {
      const aggRow = agg as Record<string, any>
      const geo = geoLookup.get(aggRow.geoid as string)
      if (!geo || !geo.geometry) { continue }

      const isSelected = aggRow.geoid === selectedGeoid
      features.push({
        type: 'Feature',
        id: geo.id.toString(),
        geometry: geo.geometry,
        properties: {
          'geoid': aggRow.geoid,
          'name': aggRow.name,
          'fill': getChoroplethColor(picked.get(aggRow.geoid as string) ?? null, palette, breaks),
          'fill-opacity': 0.45,
          'stroke': isSelected ? '#dc3545' : '#333',
          'stroke-width': isSelected ? 3 : 1.5,
          'stroke-opacity': isSelected ? 1 : 0.7,
        }
      })
    }
    return features
  })

  return {
    choroplethClassification,
    choroplethFeatures,
  }
}
