import { describe, expect, it } from 'vitest'
import {
  CENSUS_COLUMNS,
  deriveApportionedRow,
  formatAcsDatasetLabel,
  formatArea,
  formatCensusBucketLabel,
  formatCensusValue,
  summarizeBbox,
  type CensusValues,
} from './census-columns'

function byId (id: string) {
  const col = CENSUS_COLUMNS.find(c => c.id === id)
  if (!col) {
    throw new Error(`unknown column ${id}`)
  }
  return col
}

describe('derivations', () => {
  it('pct_people_of_color = (total − white_alone) / total', () => {
    const col = byId('pct_people_of_color')
    expect(col.derive({ b01003_001: 1000, b02001_002: 600 })).toBeCloseTo(0.4)
    expect(col.derive({ b01003_001: 0, b02001_002: 0 })).toBeNull()
    expect(col.derive({ b01003_001: 1000 })).toBeNull()
  })

  it('pct_no_vehicle sums owner + renter no-vehicle counts over total', () => {
    const col = byId('pct_no_vehicle')
    expect(col.derive({ b25044_001: 1000, b25044_003: 50, b25044_010: 150 })).toBeCloseTo(0.2)
    // Missing one of the components still works (treated as 0)
    expect(col.derive({ b25044_001: 1000, b25044_010: 200 })).toBeCloseTo(0.2)
    expect(col.derive({ b25044_001: 1000 })).toBeNull()
  })

  it('pct_below_200_poverty = (total − at-or-above-200%) / total', () => {
    const col = byId('pct_below_200_poverty')
    expect(col.derive({ c17002_001: 1000, c17002_008: 300 })).toBeCloseTo(0.7)
    expect(col.derive({ c17002_001: 0, c17002_008: 0 })).toBeNull()
  })

  it('avg_household_size = total_pop / occupied_units', () => {
    const col = byId('avg_household_size')
    expect(col.derive({ b01003_001: 2500, b25002_002: 1000 })).toBeCloseTo(2.5)
    expect(col.derive({ b01003_001: 2500, b25002_002: 0 })).toBeNull()
  })

  it('pct_rental_households = renter-occupied units / total occupied units', () => {
    const col = byId('pct_rental_households')
    expect(col.derive({ b25003_001: 1000, b25003_003: 400 })).toBeCloseTo(0.4)
    expect(col.derive({ b25003_001: 0, b25003_003: 0 })).toBeNull()
    expect(col.derive({ b25003_001: 1000 })).toBeNull()
  })

  it('youth_under_18 sums the expected B01001 age buckets', () => {
    const col = byId('youth_under_18')
    const values: CensusValues = {
      b01001_003: 10, b01001_004: 20, b01001_005: 30, b01001_006: 40,
      b01001_027: 11, b01001_028: 21, b01001_029: 31, b01001_030: 41,
    }
    expect(col.derive(values)).toBe(204)
  })

  it('adults_65_plus sums the expected B01001 age buckets', () => {
    const col = byId('adults_65_plus')
    const values: CensusValues = {
      b01001_020: 1, b01001_021: 2, b01001_022: 3, b01001_023: 4, b01001_024: 5, b01001_025: 6,
      b01001_044: 1, b01001_045: 2, b01001_046: 3, b01001_047: 4, b01001_048: 5, b01001_049: 6,
    }
    expect(col.derive(values)).toBe(42)
  })

  it('partial age data sums what is present (rather than returning null)', () => {
    const col = byId('adults_65_plus')
    expect(col.derive({ b01001_025: 10 })).toBe(10)
  })
})

describe('formatCensusValue', () => {
  it('renders null as em-dash regardless of format', () => {
    expect(formatCensusValue(null, 'integer')).toBe('—')
    expect(formatCensusValue(null, 'percent')).toBe('—')
    expect(formatCensusValue(null, 'currency')).toBe('—')
    expect(formatCensusValue(null, 'decimal')).toBe('—')
  })

  it('formats percent as 1-decimal %', () => {
    expect(formatCensusValue(0.1234, 'percent')).toBe('12.3%')
  })

  it('formats currency as USD with no decimals', () => {
    expect(formatCensusValue(65432, 'currency')).toBe('$65,432')
  })

  it('formats decimal to 2 places', () => {
    expect(formatCensusValue(2.4567, 'decimal')).toBe('2.46')
  })
})

describe('summarizeBbox', () => {
  it('sums raw values apportioned by intersection ratio and runs derivations', () => {
    const geos = new Map([
      ['1', { values: { b01003_001: 1000, b02001_002: 600 }, intersectionRatio: 1.0 }],
      ['2', { values: { b01003_001: 500, b02001_002: 400 }, intersectionRatio: 0.5 }],
    ])
    const { raw, derived } = summarizeBbox(['1', '2'], geos)
    // 1000*1.0 + 500*0.5 = 1250
    expect(raw.b01003_001).toBe(1250)
    // 600*1.0 + 400*0.5 = 800
    expect(raw.b02001_002).toBe(800)
    // POC% = (1250 − 800) / 1250 = 0.36
    expect(derived.pct_people_of_color).toBeCloseTo(0.36)
    expect(derived.total_population).toBe(1250)
  })
})

describe('deriveApportionedRow', () => {
  it('scales additive count columns by the intersection ratio', () => {
    const values: CensusValues = { b01003_001: 1000 }
    const out = deriveApportionedRow(values, 0.6)
    expect(out.total_population).toBeCloseTo(600)
  })

  it('leaves ratio columns unchanged (scale-invariant)', () => {
    const values: CensusValues = { b01003_001: 1000, b02001_002: 600 }
    // Full geography: (1000 − 600) / 1000 = 0.4
    // Apportioned: (600 − 360) / 600 = 0.4
    const out = deriveApportionedRow(values, 0.6)
    expect(out.pct_people_of_color).toBeCloseTo(0.4)
  })

  it('reads through the full value for non-additive columns', () => {
    const values: CensusValues = { b19013_001: 65000 }
    const out = deriveApportionedRow(values, 0.5)
    expect(out.median_household_income).toBe(65000)
  })
})

describe('formatArea', () => {
  it('switches m² to km² at 1,000,000', () => {
    expect(formatArea(1500)).toBe('1,500 m²')
    expect(formatArea(1_000_000)).toBe('1.00 km²')
    expect(formatArea(2_500_000)).toBe('2.50 km²')
  })
})

describe('formatCensusBucketLabel', () => {
  const breaks = [100, 500, 1000, 5000]
  const paletteLength = 5

  it('first bucket reads "X or less"', () => {
    expect(formatCensusBucketLabel(0, breaks, paletteLength, 'integer')).toBe('100 or less')
  })

  it('middle buckets read "X to Y"', () => {
    expect(formatCensusBucketLabel(1, breaks, paletteLength, 'integer')).toBe('100 to 500')
    expect(formatCensusBucketLabel(2, breaks, paletteLength, 'integer')).toBe('500 to 1,000')
  })

  it('last bucket reads "X or greater"', () => {
    expect(formatCensusBucketLabel(4, breaks, paletteLength, 'integer')).toBe('5,000 or greater')
  })

  it('uses the declared format for each column', () => {
    expect(formatCensusBucketLabel(0, [50000], 2, 'currency')).toBe('$50,000 or less')
    expect(formatCensusBucketLabel(0, [0.2], 2, 'percent')).toBe('20.0% or less')
  })
})

describe('formatAcsDatasetLabel', () => {
  it('parses standard Transitland dataset names', () => {
    expect(formatAcsDatasetLabel('acsdt5y2021')).toBe('ACS 5-year 2021')
    expect(formatAcsDatasetLabel('acsdt1y2022')).toBe('ACS 1-year 2022')
  })

  it('falls back to raw string on unknown format', () => {
    expect(formatAcsDatasetLabel('something-else')).toBe('something-else')
  })
})
