import { CHOROPLETH_INSUFFICIENT_COLOR, choroplethPalette } from './constants'
import type { CensusFormat } from './census-columns'
import type { CensusGeographyData } from './census-intersection'

/**
 * Pure choropleth math (#302). Extracted from `useChoroplethClassification`
 * so the bucket logic, density-mode value picker, and color lookup are
 * unit-testable in plain TS without Vue.
 *
 * Conventions:
 *   - `null` is "insufficient data" (missing ACS value, null derivation, or
 *     missing geometry area in density mode). Excluded from quantile breaks
 *     and rendered with `CHOROPLETH_INSUFFICIENT_COLOR`.
 *   - `0` is a real count and falls into the lowest bucket via the bucket
 *     loop in `getChoroplethColor`.
 */

/**
 * Default "Shade map by" element — total stop visits across the aggregation
 * row. Not a census column (lives in `stopGeoAggregateCsv` output). Exported
 * so the dropdown in `cal-filter` and the URL-state handling in `tne.vue`
 * stay in sync without duplicating the literal.
 */
export const CHOROPLETH_DEFAULT_ELEMENT = 'visit_count_total'

/**
 * Choropleth classification shared between the map (which builds it from
 * the aggregated rows) and the legend (which renders buckets from it).
 */
export interface ChoroplethClassification {
  element: string
  label: string
  format: CensusFormat
  palette: readonly string[]
  values: number[]
  breaks: number[]
  hasInsufficient: boolean
  /** When true, `values`/`breaks` are counts per km² (not raw counts). The
   * legend heading and bucket labels annotate the unit accordingly. */
  isDensity: boolean
}

/**
 * Compute the number to shade a geography by, given an aggregation row.
 * Returns `null` when the value is missing or — in density mode — the
 * geography has no area on file.
 */
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
  // Density: count per km². Backend geometryArea is m²; scale by 1,000,000
  // so labels read e.g. "5 per km²" instead of "0.000005 per m²".
  const area = geographies?.get(agg.geoid as string)?.geometryArea
  if (!area) { return null }
  return (n * 1_000_000) / area
}

/**
 * Build the bucket classification for a set of picked values. The input is
 * the per-geography output of `pickChoroplethValue`, keyed by geoid.
 *
 * Quantile breaks are deduplicated to avoid empty buckets when many
 * geographies share the same value, and the palette is truncated to match
 * so the legend and feature colorer always agree on bucket count.
 */
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

  // Quantile breaks (numClasses-1 of them).
  // TODO: consider equal-interval fallback when dedup collapses breaks.
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

/**
 * Map a picked value to its bucket color. `null` → insufficient color,
 * everything else (including 0) goes through the bucket-finding loop.
 */
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
