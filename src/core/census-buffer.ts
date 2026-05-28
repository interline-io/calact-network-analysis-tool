import type { TractIntersection } from '~~/src/tl/stop-buffer'
import type { CensusValues } from './census-columns'
import { CENSUS_COLUMNS, NON_ADDITIVE_CENSUS_COLUMNS } from './census-columns'

// TIGER layers whose GEOIDs are strict prefixes of tract GEOIDs. Pass F's
// tract list can roll up cleanly into these layers by FIPS prefix; place,
// cbsa, csa, uac20, fta-uac20-nonurban need geometric containment we don't
// have yet.
export const HIERARCHICAL_TIGER_LAYERS = new Set(['state', 'county', 'tract'])

export function apportionBuffer (intersections: TractIntersection[]): {
  values: Record<string, number | null>
  pctCoverage: number
} {
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

// `"1400000US41051010602"` → `"41051010602"`. Returns input unchanged when no
// `US` marker is present (non-TIGER datasets).
export function geoidFips (geoid: string): string {
  const idx = geoid.indexOf('US')
  return idx < 0 ? geoid : geoid.slice(idx + 2)
}

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
