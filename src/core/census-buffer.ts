// Issue #315 apportionment math for the stop statistical radius. Pure,
// deterministic, no Vue, no DOM. Consumers feed in a list of buffered
// tract intersections (from Passes C / D / E / F in src/scenario) and
// receive a Record<columnId, number | null> ready to render in the
// Stops, Routes, Agencies, and Aggregation tables.
//
// Each TractIntersection carries its ACS values inline (because the buffer
// fetch requested `values(...)` on the geography), so this module never
// has to consult Pass A. That keeps the math self-contained and trivially
// testable with hand-rolled fixtures.

import type { TractIntersection } from '~~/src/tl/stop-buffer'
import type { CensusValues } from './census-columns'
import { CENSUS_COLUMNS, NON_ADDITIVE_CENSUS_COLUMNS } from './census-columns'

export interface ApportionedBuffer {
  /** Derived ACS columns keyed by `CENSUS_COLUMNS[].id`. Non-additive
   * columns (medians) are `null` — UI is expected to render `—`. */
  values: Record<string, number | null>
  /** Fraction of the considered tract area covered by the buffer:
   * `Σ intersection_area / Σ geometry_area`. Drives the
   * `pct_buffer_coverage` column on the aggregation table. 0 when there
   * are no usable tract rows. */
  pctCoverage: number
}

/**
 * Apportion ACS values across a set of buffered tract intersections.
 *
 * For each tract: `apportioned[k] += value[k] × (intersection_area /
 * geometry_area)`. Matches the Frequent Transit Service Study
 * even-distribution-within-tract assumption referenced in #315. Tracts
 * with `geometry_area <= 0` are skipped (degenerate rows).
 */
export function apportionBuffer (intersections: TractIntersection[]): ApportionedBuffer {
  const apportioned: CensusValues = {}
  let totalGeometryArea = 0
  let totalIntersectionArea = 0
  for (const t of intersections) {
    if (!(t.geometryArea > 0)) {
      continue
    }
    const ratio = t.intersectionArea / t.geometryArea
    for (const [k, v] of Object.entries(t.values)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        apportioned[k] = (apportioned[k] ?? 0) + v * ratio
      }
    }
    totalGeometryArea += t.geometryArea
    totalIntersectionArea += t.intersectionArea
  }
  const values: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    values[col.id] = NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)
      ? null
      : col.derive(apportioned)
  }
  return {
    values,
    pctCoverage: totalGeometryArea > 0 ? totalIntersectionArea / totalGeometryArea : 0,
  }
}

/**
 * Extract the FIPS code suffix of a TIGER GEOID.
 * `"1400000US41051010602"` → `"41051010602"`. For non-TIGER GEOIDs (no
 * `US` marker), returns the geoid unchanged — apportionment for those
 * datasets falls back to single-row matching.
 */
export function geoidFips (geoid: string): string {
  const idx = geoid.indexOf('US')
  return idx < 0 ? geoid : geoid.slice(idx + 2)
}

/**
 * Roll Pass F's tract list up to a coarser TIGER aggregation row by
 * FIPS-prefix match (state / county / tract are hierarchical). For
 * non-hierarchical layers (place, cbsa, csa, uac20, fta-uac20-nonurban),
 * this returns `[]` — those layers aren't strict supersets of tracts and
 * need server-side geometric containment we don't have yet.
 */
export function tractsForAggregationRow (
  rowGeoid: string,
  tracts: TractIntersection[],
): TractIntersection[] {
  const prefix = geoidFips(rowGeoid)
  if (!prefix) {
    return []
  }
  return tracts.filter(t => geoidFips(t.geoid).startsWith(prefix))
}
