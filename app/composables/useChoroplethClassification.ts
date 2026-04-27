import { computed, type ComputedRef, type Ref } from 'vue'
import {
  CENSUS_COLUMNS,
  buildChoroplethClassification,
  densityPerArea,
  deriveApportionedColumn,
  getChoroplethColor,
  pickChoroplethValue,
  type CensusFormat,
  type CensusGeographyData,
  type ChoroplethClassification,
  type Feature,
  type UnitSystem,
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
  unitSystem: Ref<UnitSystem> | ComputedRef<UnitSystem>
}

// Wires the pure choropleth math from `src/core/choropleth.ts` to Vue refs.
export function useChoroplethClassification (input: UseChoroplethClassificationInput) {
  // Memoized so classification + feature generation share one pass.
  const pickedByGeoid = computed((): Map<string, number | null> => {
    const aggData = input.choroplethAggregateData.value
    const element = input.choroplethElement.value
    const isDensity = input.shadeByDensity.value && input.isDensityEligible.value
    const geos = input.censusGeographies.value
    const unit = input.unitSystem.value
    const out = new Map<string, number | null>()
    for (const a of aggData) {
      const row = a as Record<string, any>
      out.set(row.geoid as string, pickChoroplethValue(row, element, isDensity, geos, unit))
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
    const censusGeos = input.censusGeographies.value
    const { palette, breaks, label, format } = choroplethClassification.value
    const element = input.choroplethElement.value
    const elementCol = CENSUS_COLUMNS.find(c => c.id === element)
    const elementIsDensityEligible = elementCol?.densityEligible ?? false
    const picked = pickedByGeoid.value
    const selectedGeoid = input.selectedAggregationGeoid.value

    const features: Feature[] = []
    for (const agg of aggData) {
      const aggRow = agg as Record<string, any>
      const geo = geoLookup.get(aggRow.geoid as string)
      if (!geo || !geo.geometry) { continue }

      const isSelected = aggRow.geoid === selectedGeoid
      const pickedValue = picked.get(aggRow.geoid as string) ?? null
      const fullValue = (aggRow[element] ?? null) as number | null

      // Per-feature scaled (apportioned) + density values for the hover
      // tooltip. Both come from the per-geography ACS payload, so they're
      // null for non-census shading elements.
      let scaledValue: number | null = null
      let densityValue: number | null = null
      const censusGeo = elementCol ? censusGeos?.get(aggRow.geoid as string) : undefined
      if (elementCol && censusGeo) {
        scaledValue = deriveApportionedColumn(censusGeo.values, censusGeo.intersectionRatio, element)
        if (elementIsDensityEligible) {
          densityValue = densityPerArea(fullValue, censusGeo.geometryArea, input.unitSystem.value)
        }
      }

      features.push({
        type: 'Feature',
        id: geo.id.toString(),
        geometry: geo.geometry,
        properties: {
          'geoid': aggRow.geoid,
          'name': aggRow.name,
          // Hover-tooltip fields read by map-viewer-ts.
          'stops_count': aggRow.stops_count ?? 0,
          'routes_count': aggRow.routes_count ?? 0,
          'agencies_count': aggRow.agencies_count ?? 0,
          'visit_count_total': aggRow.visit_count_total ?? 0,
          // Currently-shaded element: total / scaled / density values.
          'shaded_element': element,
          'shaded_label': label,
          'shaded_format': format,
          'shaded_full_value': fullValue,
          'shaded_scaled_value': scaledValue,
          'shaded_density_value': densityValue,
          'fill': getChoroplethColor(pickedValue, palette, breaks),
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
