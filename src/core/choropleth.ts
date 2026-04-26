import { CHOROPLETH_INSUFFICIENT_COLOR, choroplethPalette } from './constants'
import type { CensusFormat } from './census-columns'
import type { CensusGeographyData } from './census-intersection'

// Pure choropleth math. Convention: `null` means insufficient data (excluded
// from breaks, painted with CHOROPLETH_INSUFFICIENT_COLOR); `0` is a real
// count and lands in the lowest bucket.

export const CHOROPLETH_DEFAULT_ELEMENT = 'visit_count_total'

// Choropleth elements derived from stop aggregation (not census). The hover
// tooltip skips the "shaded" line for these to avoid duplicating the
// already-shown stop/route/visits counts.
export const STOP_AGG_ELEMENT_IDS = new Set<string>([
  CHOROPLETH_DEFAULT_ELEMENT,
  'stops_count',
])

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
): number | null {
  const v = agg[element]
  if (v === null || v === undefined) { return null }
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) { return null }
  if (!isDensity) { return n }
  return densityPerKm2(n, geographies?.get(agg.geoid as string)?.geometryArea)
}

// Scale m² → km² so labels read "5 per km²" not "0.000005 per m²".
// Returns null when the value or area is missing/zero.
export function densityPerKm2 (value: number | null, areaM2: number | undefined): number | null {
  if (value === null || !Number.isFinite(value) || !areaM2 || areaM2 <= 0) {
    return null
  }
  return (value * 1_000_000) / areaM2
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
    if (value < breaks[i]!) {
      return palette[i]!
    }
  }
  return palette[palette.length - 1]!
}
