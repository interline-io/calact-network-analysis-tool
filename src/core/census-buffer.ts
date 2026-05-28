import type { CensusValues } from './census-columns'
import { CENSUS_COLUMNS, NON_ADDITIVE_CENSUS_COLUMNS } from './census-columns'
import type { CensusGeographyData } from './census-intersection'

// TIGER layers whose GEOIDs are strict prefixes of tract GEOIDs. Pass F's
// geography list can roll up cleanly into these layers by FIPS prefix;
// place, cbsa, csa, uac20, fta-uac20-nonurban need geometric containment we
// don't have yet.
export const HIERARCHICAL_TIGER_LAYERS = new Set(['state', 'county', 'tract'])

// Unified shape for "one census geography with its intersection against some
// shape (the scenario's query area, or a single entity's stop buffer)." Both
// the scenario pipeline's `CensusGeographyData` map and the buffer fetch's
// `BufferGeographyIntersection[]` are structurally compatible — pass either
// into `<cal-census-details>` and consumers of `apportionBuffer`.
export interface CensusGeographyEntry {
  geoid: string
  name?: string
  layer?: string
  geometryArea: number
  intersectionArea: number
  // Optional convenience: when present, callers can read it directly instead
  // of recomputing `intersectionArea / geometryArea`.
  intersectionRatio?: number
  values: CensusValues
  // Populated only by the buffer fetch when `includeGeometry: true`. The
  // map tab renders these; non-buffer callers omit them.
  geometry?: GeoJSON.MultiPolygon
  intersectionGeometry?: GeoJSON.Geometry
}

// Adapter for the scenario pipeline's `Map<geoid, CensusGeographyData>` shape.
// `nameFor` is an optional GEOID → name lookup (usually built from
// `stops.census_geographies`); omit when the parent has no name source.
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
