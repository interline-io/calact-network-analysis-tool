import type { CensusValues, CensusGeographyData } from './census-columns'
import { CENSUS_COLUMNS, NON_ADDITIVE_CENSUS_COLUMNS } from './census-columns'

// FIPS-prefix-rollup-safe layers, coarse→fine: a finer geoid's FIPS digits start with
// its parent's (block group nests in tract, tract in county, county in state), so
// geoidFips prefix-matching rolls them up safely. Place/cbsa/csa/uac/fta-uac20-nonurban
// don't nest by FIPS and need server-side geometric containment (see #370).
export const HIERARCHICAL_TIGER_LAYERS = new Set(['state', 'county', 'tract', 'bg'])

// Shared shape for `CensusGeographyData` (scenario pipeline) and
// `BufferGeographyIntersection` (per-entity buffer fetch) — both pass
// directly into `apportionBuffer` and `<cal-census-details>`.
export interface CensusGeographyEntry {
  geoid: string
  name?: string
  layer?: string
  geometryArea: number
  intersectionArea: number
  intersectionRatio?: number
  values: CensusValues
  // Buffer-fetch only, gated by `includeGeometry: true`.
  geometry?: GeoJSON.MultiPolygon
  intersectionGeometry?: GeoJSON.Geometry
}

export function censusGeographyMapToEntries (
  m: Map<string, CensusGeographyData> | undefined,
  nameFor?: (geoid: string) => string | undefined,
): CensusGeographyEntry[] {
  if (!m) {
    return []
  }
  const out: CensusGeographyEntry[] = []
  for (const [geoid, data] of m) {
    out.push({
      geoid,
      name: nameFor?.(geoid) ?? data.name ?? undefined,
      layer: data.layer,
      geometryArea: data.geometryArea,
      intersectionArea: data.intersectionArea,
      intersectionRatio: data.intersectionRatio,
      values: data.values,
    })
  }
  return out
}

export function apportionBuffer (intersections: CensusGeographyEntry[]): {
  values: Record<string, number | null>
  pctCoverage: number
} {
  const apportioned: CensusValues = {}
  let totalGeometryArea = 0
  let totalIntersectionArea = 0
  for (const g of intersections) {
    if (!(g.geometryArea > 0)) {
      continue
    }
    const ratio = g.intersectionArea / g.geometryArea
    for (const [k, v] of Object.entries(g.values)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        apportioned[k] = (apportioned[k] ?? 0) + v * ratio
      }
    }
    totalGeometryArea += g.geometryArea
    totalIntersectionArea += g.intersectionArea
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

export function geographiesForAggregationRow<T extends { geoid: string }> (
  rowGeoid: string,
  geographies: T[],
): T[] {
  const prefix = geoidFips(rowGeoid)
  if (!prefix) {
    return []
  }
  return geographies.filter(g => geoidFips(g.geoid).startsWith(prefix))
}
