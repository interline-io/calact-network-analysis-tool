import { describe, expect, it } from 'vitest'
import type { BufferGeographyIntersection } from '~~/src/tl/stop-buffer'
import { apportionBuffer, censusEntryRow, censusGeographyMapToEntries, geoidFips, geographiesForAggregationRow } from './census-buffer'
import type { CensusGeographyData } from './census-columns'

// Helper: build a BufferGeographyIntersection with sensible defaults so tests
// focus on the bits they care about.
function geography (opts: Partial<BufferGeographyIntersection> & { geoid: string }): BufferGeographyIntersection {
  return {
    geoid: opts.geoid,
    layer: opts.layer ?? 'tract',
    geometryArea: opts.geometryArea ?? 1000,
    intersectionArea: opts.intersectionArea ?? 1000,
    values: opts.values ?? {},
  }
}

describe('apportionBuffer', () => {
  it('full overlap of a single tract returns the tract\'s population as-is', () => {
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 1000,
        intersectionArea: 1000,
        values: { b01003_001: 4000 },
      }),
    ])
    expect(out.values.total_population).toBe(4000)
    expect(out.pctCoverage).toBe(1)
  })

  it('half overlap of a single tract halves the count', () => {
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 1000,
        intersectionArea: 500,
        values: { b01003_001: 4000 },
      }),
    ])
    expect(out.values.total_population).toBeCloseTo(2000)
    expect(out.pctCoverage).toBeCloseTo(0.5)
  })

  it('25%-covered tract reports a quarter of the population (#315 example)', () => {
    // From the issue text: "if the total population of a block group is 4k
    // and 25% of it is covered by stop statistical radii, then the number
    // reported should be 1k". Same math applies to tracts.
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 4000,
        intersectionArea: 1000,
        values: { b01003_001: 4000 },
      }),
    ])
    expect(out.values.total_population).toBeCloseTo(1000)
    expect(out.pctCoverage).toBeCloseTo(0.25)
  })

  it('sums apportioned counts across multiple tracts', () => {
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 1000,
        intersectionArea: 500,
        values: { b01003_001: 2000 },
      }),
      geography({
        geoid: '1400000US41051000200',
        geometryArea: 2000,
        intersectionArea: 500,
        values: { b01003_001: 4000 },
      }),
    ])
    // 2000 × 0.5 + 4000 × 0.25 = 2000
    expect(out.values.total_population).toBeCloseTo(2000)
    // (500 + 500) / (1000 + 2000) = 1/3
    expect(out.pctCoverage).toBeCloseTo(1 / 3)
  })

  it('median income renders as null (non-additive across geographies)', () => {
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 1000,
        intersectionArea: 500,
        values: { b19013_001: 65_000 },
      }),
    ])
    expect(out.values.median_household_income).toBeNull()
  })

  it('skips tracts with zero geometry_area', () => {
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 0,
        intersectionArea: 0,
        values: { b01003_001: 9999 },
      }),
      geography({
        geoid: '1400000US41051000200',
        geometryArea: 1000,
        intersectionArea: 1000,
        values: { b01003_001: 500 },
      }),
    ])
    expect(out.values.total_population).toBe(500)
    expect(out.pctCoverage).toBe(1)
  })

  it('empty input yields zeroed coverage and null derivations', () => {
    const out = apportionBuffer([])
    expect(out.pctCoverage).toBe(0)
    expect(out.values.total_population).toBeNull()
  })

  it('apportions a derived ratio column even when sums are partial', () => {
    // pct_people_of_color = (total - white) / total. Half-overlap with a
    // tract that's 1000 total / 600 white should still report 0.4 because
    // both numerator and denominator scale by the same ratio.
    const out = apportionBuffer([
      geography({
        geoid: '1400000US41051000100',
        geometryArea: 1000,
        intersectionArea: 500,
        values: { b01003_001: 1000, b02001_002: 600 },
      }),
    ])
    expect(out.values.pct_people_of_color).toBeCloseTo(0.4)
  })
})

describe('censusEntryRow', () => {
  // 1000 people over 1000 m²: 800 m² in the query area, 500 m² of that outside
  // the stop buffers.
  const tract: CensusGeographyData = {
    id: 1,
    name: 'Tract 1',
    values: { b01003_001: 1000, b19013_001: 80000 },
    geometryArea: 1000,
    intersectionArea: 800,
    intersectionRatio: 0.8,
    bufferIntersectionArea: 300,
    bufferIntersectionRatio: 0.3,
    outsideIntersectionArea: 500,
    outsideIntersectionRatio: 0.5,
  }
  const [outside] = censusGeographyMapToEntries(new Map([['1400000US41051010600', tract]]), 'outside')

  it('reports the clip its entry was made for', () => {
    const row = censusEntryRow(outside!, true)
    expect(row.geoid).toBe('1400000US41051010600')
    expect(row.geometry_area_m2).toBe(1000)
    expect(row.intersection_area_m2).toBe(500)
    expect(row.intersection_pct).toBe(0.5)
    expect(row.total_population).toBe(500)
    expect(row.median_household_income).toBe(80000)
  })

  it('keeps the full values unless scaled', () => {
    expect(censusEntryRow(outside!, false).total_population).toBe(1000)
  })

  // Per-entity buffer entries carry areas but no ratio.
  it('takes the ratio from the areas when the entry has none', () => {
    const row = censusEntryRow(geography({
      geoid: '1400000US41051010100',
      geometryArea: 1000,
      intersectionArea: 250,
      values: { b01003_001: 400 },
    }), true)
    expect(row.intersection_pct).toBe(0.25)
    expect(row.total_population).toBe(100)
  })
})

describe('geoidFips', () => {
  it('strips the layer prefix and US separator', () => {
    expect(geoidFips('0500000US41051')).toBe('41051')
    expect(geoidFips('1400000US41051010602')).toBe('41051010602')
    expect(geoidFips('0400000US41')).toBe('41')
  })

  it('returns the input unchanged when no US separator is present', () => {
    expect(geoidFips('abc-123')).toBe('abc-123')
  })
})

describe('geographiesForAggregationRow', () => {
  const tracts = [
    geography({ geoid: '1400000US41051010100' }), // Multnomah County
    geography({ geoid: '1400000US41051010200' }), // Multnomah County
    geography({ geoid: '1400000US41067030100' }), // Washington County
    geography({ geoid: '1400000US53033010100' }), // King County, WA
  ]

  it('filters tracts within a county by FIPS prefix', () => {
    const out = geographiesForAggregationRow('0500000US41051', tracts)
    expect(out.map(t => t.geoid)).toEqual([
      '1400000US41051010100',
      '1400000US41051010200',
    ])
  })

  it('returns every tract in a state when given the state GEOID', () => {
    const out = geographiesForAggregationRow('0400000US41', tracts)
    expect(out.map(t => t.geoid)).toEqual([
      '1400000US41051010100',
      '1400000US41051010200',
      '1400000US41067030100',
    ])
  })

  it('exact tract GEOID returns just that tract', () => {
    const out = geographiesForAggregationRow('1400000US41051010100', tracts)
    expect(out.map(t => t.geoid)).toEqual(['1400000US41051010100'])
  })

  it('no match returns empty', () => {
    expect(geographiesForAggregationRow('0500000US99999', tracts)).toEqual([])
  })

  it('rolls a block group up under its tract, county, and state', () => {
    // A block-group geoid is its tract geoid (11 FIPS digits) plus one digit, so it
    // prefix-nests under tract -> county -> state exactly like a tract does. This pins
    // the bg membership added to HIERARCHICAL_TIGER_LAYERS.
    const bgs = [
      geography({ geoid: '1500000US410510101001', layer: 'bg' }), // tract 41051010100
      geography({ geoid: '1500000US410510101002', layer: 'bg' }), // tract 41051010100
      geography({ geoid: '1500000US410670301001', layer: 'bg' }), // Washington County
    ]
    expect(geographiesForAggregationRow('1400000US41051010100', bgs).map(g => g.geoid)).toEqual([
      '1500000US410510101001',
      '1500000US410510101002',
    ])
    expect(geographiesForAggregationRow('0500000US41051', bgs).map(g => g.geoid)).toEqual([
      '1500000US410510101001',
      '1500000US410510101002',
    ])
    expect(geographiesForAggregationRow('0400000US41', bgs).map(g => g.geoid)).toEqual([
      '1500000US410510101001',
      '1500000US410510101002',
      '1500000US410670301001',
    ])
  })
})
