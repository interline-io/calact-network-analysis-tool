import { describe, expect, it } from 'vitest'
import { CHOROPLETH_INSUFFICIENT_COLOR, choroplethPalette } from './constants'
import {
  buildChoroplethClassification,
  getChoroplethColor,
  pickChoroplethValue,
} from './choropleth'
import type { CensusGeographyData } from './census-intersection'

function picked (entries: Array<[string, number | null]>): Map<string, number | null> {
  return new Map(entries)
}

describe('pickChoroplethValue', () => {
  it('returns 0 when the value is 0 (not null)', () => {
    expect(pickChoroplethValue({ x: 0, geoid: '1' }, 'x', false, undefined)).toBe(0)
  })

  it('returns null when the value is missing or non-finite', () => {
    expect(pickChoroplethValue({ geoid: '1' }, 'x', false, undefined)).toBeNull()
    expect(pickChoroplethValue({ x: null, geoid: '1' }, 'x', false, undefined)).toBeNull()
    expect(pickChoroplethValue({ x: 'not a number', geoid: '1' }, 'x', false, undefined)).toBeNull()
    expect(pickChoroplethValue({ x: Number.POSITIVE_INFINITY, geoid: '1' }, 'x', false, undefined)).toBeNull()
  })

  it('density mode scales by 1,000,000 / area_m² → counts per km²', () => {
    // 1000 commuters in a 5 km² (= 5,000,000 m²) area = 200 per km²
    const geos = new Map<string, CensusGeographyData>([
      ['1', { values: {}, intersectionRatio: 1, geometryArea: 5_000_000, intersectionArea: 5_000_000 }],
    ])
    expect(pickChoroplethValue({ x: 1000, geoid: '1' }, 'x', true, geos)).toBe(200)
  })

  it('density mode returns null when geometry area is missing', () => {
    expect(pickChoroplethValue({ x: 1000, geoid: '1' }, 'x', true, undefined)).toBeNull()
    const geos = new Map<string, CensusGeographyData>()
    expect(pickChoroplethValue({ x: 1000, geoid: '1' }, 'x', true, geos)).toBeNull()
  })
})

describe('buildChoroplethClassification', () => {
  it('marks hasInsufficient when any picked value is null', () => {
    const c = buildChoroplethClassification({
      pickedByGeoid: picked([['1', 10], ['2', null], ['3', 20]]),
      element: 'x', label: 'X', format: 'integer', isDensity: false,
    })
    expect(c.hasInsufficient).toBe(true)
    // null is excluded from values; 10 and 20 are present.
    expect(c.values).toEqual([10, 20])
  })

  it('does NOT mark hasInsufficient when 0 is the lowest value', () => {
    const c = buildChoroplethClassification({
      pickedByGeoid: picked([['1', 0], ['2', 5], ['3', 10]]),
      element: 'x', label: 'X', format: 'integer', isDensity: false,
    })
    expect(c.hasInsufficient).toBe(false)
    expect(c.values).toEqual([0, 5, 10])
  })

  it('palette is truncated to breaks.length + 1', () => {
    // 5 distinct values → up to 4 breaks → palette length ≤ 5.
    const c = buildChoroplethClassification({
      pickedByGeoid: picked([['1', 1], ['2', 2], ['3', 3], ['4', 4], ['5', 5]]),
      element: 'x', label: 'X', format: 'integer', isDensity: false,
    })
    expect(c.palette.length).toBe(c.breaks.length + 1)
    expect(c.palette.length).toBeLessThanOrEqual(choroplethPalette.length)
  })

  it('collapses palette when all values are identical', () => {
    const c = buildChoroplethClassification({
      pickedByGeoid: picked([['1', 7], ['2', 7], ['3', 7]]),
      element: 'x', label: 'X', format: 'integer', isDensity: false,
    })
    expect(c.breaks).toEqual([7])
    expect(c.palette.length).toBe(2)
  })

  it('handles all-null input without throwing', () => {
    const c = buildChoroplethClassification({
      pickedByGeoid: picked([['1', null], ['2', null]]),
      element: 'x', label: 'X', format: 'integer', isDensity: false,
    })
    expect(c.values).toEqual([])
    expect(c.hasInsufficient).toBe(true)
  })
})

describe('getChoroplethColor', () => {
  const palette = choroplethPalette
  const breaks = [100, 500, 1000, 5000]

  it('returns the insufficient color for null', () => {
    expect(getChoroplethColor(null, palette, breaks)).toBe(CHOROPLETH_INSUFFICIENT_COLOR)
  })

  it('routes 0 into the lowest bucket (not insufficient)', () => {
    expect(getChoroplethColor(0, palette, breaks)).toBe(palette[0])
  })

  it('routes mid-range values into mid buckets', () => {
    expect(getChoroplethColor(250, palette, breaks)).toBe(palette[1])
    expect(getChoroplethColor(750, palette, breaks)).toBe(palette[2])
    expect(getChoroplethColor(2500, palette, breaks)).toBe(palette[3])
  })

  it('routes >= last break into the highest bucket', () => {
    expect(getChoroplethColor(10_000, palette, breaks)).toBe(palette[palette.length - 1])
  })

  it('is exclusive on break boundaries (value < break)', () => {
    // exactly at a break value lands in the next-up bucket
    expect(getChoroplethColor(100, palette, breaks)).toBe(palette[1])
    expect(getChoroplethColor(500, palette, breaks)).toBe(palette[2])
  })
})
