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

/**
 * Choropleth state for the aggregation-area overlay (#302). Produces the
 * element classification (quantile breaks + palette + display metadata) and
 * the GeoJSON features for the map layer from the scenario's aggregate rows
 * and the user's "Shade map by" / density toggles.
 *
 * Pure math (value picker, classification builder, color lookup) lives in
 * `src/core/choropleth.ts`; this composable wires it to Vue refs and
 * memoizes the per-geography picked values so we don't re-walk the
 * aggregation rows three times per render.
 */
export function useChoroplethClassification (input: UseChoroplethClassificationInput) {
  // Single pass over aggData → geoid → number|null. Reused by the
  // classification (for `values` + `hasInsufficient`) and by feature
  // generation (for fill color lookup).
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

  // Geoid -> geometry lookup, memoized on the fetched choropleth geographies
  // so it isn't rebuilt every time the shade-by-density toggle fires.
  const choroplethGeoLookup = computed((): Map<string, CensusGeography> => {
    const lookup = new Map<string, CensusGeography>()
    for (const ds of input.choroplethGeoResult.value?.census_datasets || []) {
      for (const geo of ds.geographies || []) {
        lookup.set(geo.geoid, geo)
      }
    }
    return lookup
  })

  // GeoJSON features for the map's choropleth layer. Feature properties
  // intentionally carry only `geoid`/`name` and the styling fields consumed
  // by maplibre — the census panel hydrates from `choroplethAggregateData`
  // by geoid on click rather than reading bulky aggregate fields back out
  // of feature properties.
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
