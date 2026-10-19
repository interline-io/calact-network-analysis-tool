import {
  censusClip,
  deriveApportionedRow,
  deriveCensusRow,
  summarizeApportioned,
  type CensusGeographyData,
} from './census-columns'

// Derived census statistics for one column of the census panel, keyed by
// column id.
export type CensusPanelValues = Record<string, number | null>

// A geography's part inside one stop-buffer clip: its statistics, its area in
// m², and its share of the geography.
export interface CensusPanelClip {
  values: CensusPanelValues
  area: number
  ratio: number
}

// The census panel's Selected geography tab. The clips stay inside the query
// area, so inside and outside add up to `queryAreaRatio` of the geography, not
// to its total. Each clip is null when the scenario has no stop buffers.
export interface CensusPanelGeography {
  total: CensusPanelValues
  geometryArea: number
  queryArea: number
  queryAreaRatio: number
  inside: CensusPanelClip | null
  outside: CensusPanelClip | null
}

// The census panel's Analysis area tab: the whole query area, and its parts
// inside and outside the stop buffers. Inside and outside are null when the
// scenario has no stop buffers.
export interface CensusPanelAnalysisArea {
  total: CensusPanelValues
  inside: CensusPanelValues | null
  outside: CensusPanelValues | null
}

// One geography's full values and its two stop-buffer clips, each taken from
// the server's clip with no fallback to the query area.
export function censusPanelGeography (geo: CensusGeographyData): CensusPanelGeography {
  const clip = (mode: 'buffer' | 'outside'): CensusPanelClip | null => {
    const c = censusClip(geo, mode)
    return c && { values: deriveApportionedRow(geo.values, c.ratio), area: c.area, ratio: c.ratio }
  }
  return {
    total: deriveCensusRow(geo.values),
    geometryArea: geo.geometryArea,
    queryArea: geo.intersectionArea,
    queryAreaRatio: geo.intersectionRatio,
    inside: clip('buffer'),
    outside: clip('outside'),
  }
}

// Every geography's share of the query area summed, and likewise its shares
// inside and outside the stop buffers.
export function censusPanelAnalysisArea (geographies: Map<string, CensusGeographyData>): CensusPanelAnalysisArea {
  const geos = [...geographies.values()]
  const sum = (mode: 'queryArea' | 'buffer' | 'outside'): CensusPanelValues =>
    summarizeApportioned(geographies.keys(), geographies, mode).derived
  // The clip passes fill every geography or none, so a clip found on any
  // geography is on all of them, and summing it never falls back.
  const has = (mode: 'buffer' | 'outside'): boolean => geos.some(geo => censusClip(geo, mode) !== null)
  return {
    total: sum('queryArea'),
    inside: has('buffer') ? sum('buffer') : null,
    outside: has('outside') ? sum('outside') : null,
  }
}
