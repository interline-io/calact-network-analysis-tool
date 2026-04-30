import { CHOROPLETH_INSUFFICIENT_COLOR, choroplethPalette } from './constants'
import { CENSUS_COLUMNS, sqMetersPerLargeUnit, toFiniteNumber, type CensusFormat, type UnitSystem } from './census-columns'
import type { CensusGeographyData } from './census-intersection'

// Pure choropleth math. Convention: `null` means insufficient data (excluded
// from breaks, painted with CHOROPLETH_INSUFFICIENT_COLOR); `0` is a real
// count and lands in the lowest bucket.

export const CHOROPLETH_DEFAULT_ELEMENT = 'visit_count_total'

// Stop-aggregation choropleth elements (not census). Listed alongside
// CENSUS_COLUMNS in the "Shade map by" dropdown. None are density-eligible:
// the numerator is the bbox slice while the divisor would be the full
// geometry area, so partial-coverage geographies under-report.
export interface StopAggChoroplethOption {
  value: string
  label: string
  densityEligible: boolean
}

export const STOP_AGG_CHOROPLETH_OPTIONS: StopAggChoroplethOption[] = [
  { value: CHOROPLETH_DEFAULT_ELEMENT, label: 'Total stop visits', densityEligible: false },
  { value: 'stops_count', label: 'Number of stops', densityEligible: false },
]

// Element IDs from STOP_AGG_CHOROPLETH_OPTIONS, set form. The hover tooltip
// skips the "shaded" line for these to avoid duplicating already-shown counts.
export const STOP_AGG_ELEMENT_IDS = new Set<string>(
  STOP_AGG_CHOROPLETH_OPTIONS.map(o => o.value),
)

// Full set of "Shade map by" dropdown options (stop-aggregation + census).
export const CHOROPLETH_ELEMENT_OPTIONS: { label: string, value: string }[] = [
  ...STOP_AGG_CHOROPLETH_OPTIONS.map(o => ({ label: o.label, value: o.value })),
  ...CENSUS_COLUMNS.map(c => ({ label: c.label, value: c.id })),
]

const DENSITY_ELIGIBLE_BY_ELEMENT: Record<string, boolean> = {
  ...Object.fromEntries(STOP_AGG_CHOROPLETH_OPTIONS.map(o => [o.value, o.densityEligible])),
  ...Object.fromEntries(CENSUS_COLUMNS.map(c => [c.id, c.densityEligible])),
}

// Whether the "Shade as density" toggle applies to the given element id.
export function isElementDensityEligible (elementId: string): boolean {
  return DENSITY_ELIGIBLE_BY_ELEMENT[elementId] === true
}

export interface ChoroplethClassification {
  element: string
  label: string
  format: CensusFormat
  palette: readonly string[]
  values: number[]
  breaks: number[]
  hasInsufficient: boolean
  // values/breaks are per km² when true.
  isDensity: boolean
}

export function pickChoroplethValue (
  agg: Record<string, unknown>,
  element: string,
  isDensity: boolean,
  geographies: Map<string, CensusGeographyData> | undefined,
  unitSystem: UnitSystem,
): number | null {
  const n = toFiniteNumber(agg[element])
  if (n === null) { return null }
  if (!isDensity) { return n }
  return densityPerArea(n, geographies?.get(agg.geoid as string)?.geometryArea, unitSystem)
}

// Counts per km² (eu) or per mi² (us). Returns null when value/area missing.
export function densityPerArea (
  value: number | null,
  areaM2: number | undefined,
  unitSystem: UnitSystem,
): number | null {
  if (value === null || !Number.isFinite(value) || !areaM2 || areaM2 <= 0) {
    return null
  }
  return (value * sqMetersPerLargeUnit(unitSystem)) / areaM2
}

// Quantile breaks are deduped (so the legend doesn't show empty buckets when
// many geographies share a value); the palette is truncated to match.
export function buildChoroplethClassification (args: {
  pickedByGeoid: Map<string, number | null>
  element: string
  label: string
  format: CensusFormat
  isDensity: boolean
}): ChoroplethClassification {
  const values: number[] = []
  let hasInsufficient = false
  for (const v of args.pickedByGeoid.values()) {
    if (v === null) {
      hasInsufficient = true
    } else {
      values.push(v)
    }
  }
  values.sort((a, b) => a - b)

  const fullPalette = choroplethPalette
  const numClasses = fullPalette.length

  // TODO: equal-interval fallback when dedup collapses breaks.
  const rawBreaks: number[] = []
  for (let i = 1; i < numClasses; i++) {
    const idx = Math.floor((i / numClasses) * values.length)
    rawBreaks.push(values[idx] ?? 0)
  }
  const breaks = Array.from(new Set(rawBreaks))
  const palette = fullPalette.slice(0, breaks.length + 1)

  return {
    element: args.element,
    label: args.label,
    format: args.format,
    palette,
    values,
    breaks,
    hasInsufficient,
    isDensity: args.isDensity,
  }
}

export function getChoroplethColor (
  value: number | null,
  palette: readonly string[],
  breaks: number[],
): string {
  if (value === null) {
    return CHOROPLETH_INSUFFICIENT_COLOR
  }
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]!) {
      return palette[i]!
    }
  }
  return palette[palette.length - 1]!
}
