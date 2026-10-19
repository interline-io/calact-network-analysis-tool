import {
  deriveApportionedRow,
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
  const clip = (ratio: number | undefined, area: number | undefined): CensusPanelClip | null => {
    if (ratio == null) {
      return null
    }
    return { values: deriveApportionedRow(geo.values, ratio), area: area ?? 0, ratio }
  }
  return {
    total: deriveApportionedRow(geo.values, 1),
    geometryArea: geo.geometryArea,
    queryAreaRatio: geo.intersectionRatio,
    inside: clip(geo.bufferIntersectionRatio, geo.bufferIntersectionArea),
    outside: clip(geo.outsideIntersectionRatio, geo.outsideIntersectionArea),
  }
}

// Every geography's share of the query area summed, and likewise its shares
// inside and outside the stop buffers.
export function censusPanelAnalysisArea (geographies: Map<string, CensusGeographyData>): CensusPanelAnalysisArea {
  const geos = [...geographies.values()]
  const sum = (ratioOf: (geo: CensusGeographyData) => number | null): CensusPanelValues =>
    summarizeApportioned(geographies.keys(), geographies, ratioOf).derived
  // The clip passes fill every geography or none.
  const hasBuffer = geos.some(geo => geo.bufferIntersectionRatio != null)
  const hasOutside = geos.some(geo => geo.outsideIntersectionRatio != null)
  return {
    total: sum(geo => geo.intersectionRatio),
    inside: hasBuffer ? sum(geo => geo.bufferIntersectionRatio ?? null) : null,
    outside: hasOutside ? sum(geo => geo.outsideIntersectionRatio ?? null) : null,
  }
}
