import { computed, type ComputedRef, type Ref } from 'vue'
import {
  CENSUS_COLUMNS,
  choroplethPalette,
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
 * Pulled out of `tne.vue` so the map-shading math can be unit-tested
 * independently and so the page file isn't 2000+ lines of mixed concerns.
 */
export function useChoroplethClassification (input: UseChoroplethClassificationInput) {
  // Pure value picker: returns the number to shade by for a given aggregation
  // row. Applies density conversion when active.
  function pickChoroplethValue (
    agg: Record<string, any>,
    element: string,
    isDensity: boolean,
    geographies: Map<string, CensusGeographyData> | undefined,
  ): number | null {
    const v = agg[element]
    if (v === null || v === undefined) { return null }
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) { return null }
    if (!isDensity) { return n }
    // Density: count per km². Backend geometryArea is m²; scale by 1,000,000
    // so labels read e.g. "5 per km²" instead of "0.000005 per m²".
    const area = geographies?.get(agg.geoid as string)?.geometryArea
    if (!area || area === 0) { return null }
    return (n * 1_000_000) / area
  }

  // Classification of the chosen element across all aggregation rows.
  // Reused by both the choropleth feature colors and the legend's bucket list.
  const choroplethClassification = computed((): ChoroplethClassification => {
    const element = input.choroplethElement.value
    const aggData = input.choroplethAggregateData.value
    const label = input.choroplethElementOptions.value.find(o => o.value === element)?.label || element
    const format: CensusFormat = CENSUS_COLUMNS.find(c => c.id === element)?.format || 'integer'
    const isDensity = input.shadeByDensity.value && input.isDensityEligible.value
    const geos = input.censusGeographies.value

    const values = aggData
      .map(a => pickChoroplethValue(a as Record<string, any>, element, isDensity, geos))
      .filter((v): v is number => v !== null && v > 0)
      .sort((a, b) => a - b)

    const fullPalette = choroplethPalette
    const numClasses = fullPalette.length

    // Quantile breaks (numClasses-1 of them). Dedupe to avoid empty buckets
    // when many geographies share the same value.
    // TODO: consider equal-interval fallback when dedup collapses breaks.
    const rawBreaks: number[] = []
    for (let i = 1; i < numClasses; i++) {
      const idx = Math.floor((i / numClasses) * values.length)
      rawBreaks.push(values[idx] ?? 0)
    }
    const breaks = Array.from(new Set(rawBreaks))

    // Truncate the palette to breaks.length + 1 so the legend and the
    // feature colorer always agree on bucket count. Without this, dedupe
    // can leave more palette slots than distinct regions — buckets at the
    // tail would render with undefined bounds as blank rows.
    const palette = fullPalette.slice(0, breaks.length + 1)

    const hasInsufficient = aggData.some(a => (pickChoroplethValue(a as Record<string, any>, element, isDensity, geos) ?? 0) <= 0)

    return {
      element,
      label,
      format,
      palette,
      values,
      breaks,
      hasInsufficient,
      isDensity,
    }
  })

  function getChoroplethColor (value: number | null): string {
    const { palette, breaks } = choroplethClassification.value
    if (value === null || value <= 0) {
      return palette[0]!
    }
    for (let i = 0; i < breaks.length; i++) {
      if (value < breaks[i]!) {
        return palette[i]!
      }
    }
    return palette[palette.length - 1]!
  }

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
    const { element, isDensity } = choroplethClassification.value
    const geos = input.censusGeographies.value
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
          'fill': getChoroplethColor(pickChoroplethValue(aggRow, element, isDensity, geos)),
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
