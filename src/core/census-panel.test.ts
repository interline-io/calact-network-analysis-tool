import { describe, expect, it } from 'vitest'
import type { CensusGeographyData } from './census-columns'
import { censusPanelAnalysisArea, censusPanelGeography } from './census-panel'

// 1000 people and $80,000 median income over 1000 m². 80% lies inside the
// query area: 300 m² inside the stop buffers and 500 m² outside them.
function tract (over: Partial<CensusGeographyData> = {}): CensusGeographyData {
  return {
    id: 1,
    name: 'Tract 1',
    values: { b01003_001: 1000, b02001_002: 600, b19013_001: 80000 },
    geometryArea: 1000,
    intersectionArea: 800,
    intersectionRatio: 0.8,
    bufferIntersectionArea: 300,
    bufferIntersectionRatio: 0.3,
    outsideIntersectionArea: 500,
    outsideIntersectionRatio: 0.5,
    ...over,
  }
}

describe('censusPanelGeography', () => {
  it('reports the full geography and each clip on its own', () => {
    const panel = censusPanelGeography(tract())
    expect(panel.total.total_population).toBe(1000)
    expect(panel.inside?.values.total_population).toBe(300)
    expect(panel.outside?.values.total_population).toBe(500)
    expect(panel.inside?.area).toBe(300)
    expect(panel.outside?.area).toBe(500)
    // The share beyond the query area belongs to neither clip.
    expect(panel.queryAreaRatio).toBe(0.8)
  })

  it('keeps ratios and medians unscaled in every column', () => {
    const panel = censusPanelGeography(tract())
    for (const values of [panel.total, panel.inside!.values, panel.outside!.values]) {
      expect(values.pct_people_of_color).toBeCloseTo(0.4)
      expect(values.median_household_income).toBe(80000)
    }
  })

  // The map modes fall back to the query area when a clip is missing; the
  // panel shows the clip as missing instead.
  it('has no clips when the scenario has no stop buffers', () => {
    const panel = censusPanelGeography(tract({
      bufferIntersectionArea: undefined,
      bufferIntersectionRatio: undefined,
      outsideIntersectionArea: undefined,
      outsideIntersectionRatio: undefined,
    }))
    expect(panel.inside).toBeNull()
    expect(panel.outside).toBeNull()
    expect(panel.total.total_population).toBe(1000)
  })
})

describe('censusPanelAnalysisArea', () => {
  it('sums each geography\'s query-area share and its two clips', () => {
    const geos = new Map([
      ['1', tract()],
      ['2', tract({ values: { b01003_001: 200 }, intersectionRatio: 1, bufferIntersectionRatio: 0.25, outsideIntersectionRatio: 0.75 })],
    ])
    const area = censusPanelAnalysisArea(geos)
    // 1000*0.8 + 200*1
    expect(area.total.total_population).toBe(1000)
    // 1000*0.3 + 200*0.25
    expect(area.inside?.total_population).toBe(350)
    // 1000*0.5 + 200*0.75
    expect(area.outside?.total_population).toBe(650)
  })

  it('has no clip sums when the scenario has no stop buffers', () => {
    const geos = new Map([['1', tract({ bufferIntersectionRatio: undefined, outsideIntersectionRatio: undefined })]])
    const area = censusPanelAnalysisArea(geos)
    expect(area.total.total_population).toBe(800)
    expect(area.inside).toBeNull()
    expect(area.outside).toBeNull()
  })
})
