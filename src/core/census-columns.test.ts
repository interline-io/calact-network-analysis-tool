import { describe, expect, it } from 'vitest'
import {
  CENSUS_COLUMNS,
  REQUIRED_ACS_TABLES,
  deriveCensusRow,
  formatAcsDatasetLabel,
  formatCensusValue,
  type CensusValues,
} from './census-columns'

function byId (id: string) {
  const col = CENSUS_COLUMNS.find(c => c.id === id)
  if (!col) {
    throw new Error(`unknown column ${id}`)
  }
  return col
}

describe('CENSUS_COLUMNS', () => {
  it('exposes all 11 columns from issue #302', () => {
    expect(CENSUS_COLUMNS.map(c => c.id)).toEqual([
      'total_population',
      'pct_people_of_color',
      'public_transit_commuters',
      'pct_no_vehicle',
      'pct_below_200_poverty',
      'median_household_income',
      'avg_household_size',
      'pct_rental_households',
      'youth_under_18',
      'adults_65_plus',
      'working_age_with_disability',
    ])
  })

  it('REQUIRED_ACS_TABLES is the sorted union of per-column requirements', () => {
    expect(REQUIRED_ACS_TABLES).toEqual([
      'b01001', 'b01003', 'b02001', 'b08301', 'b19013',
      'b23024', 'b25002', 'b25008', 'b25044', 'c17002',
    ])
  })
})

describe('derivations', () => {
  it('returns null when the required value is missing', () => {
    expect(byId('total_population').derive({})).toBeNull()
    expect(byId('median_household_income').derive({})).toBeNull()
  })

  it('total_population reads b01003_001 directly', () => {
    expect(byId('total_population').derive({ b01003_001: 1000 })).toBe(1000)
  })

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

describe('deriveCensusRow', () => {
  it('returns a value for every column id', () => {
    const row = deriveCensusRow({ b01003_001: 500 })
    for (const col of CENSUS_COLUMNS) {
      expect(row).toHaveProperty(col.id)
    }
    expect(row.total_population).toBe(500)
    expect(row.median_household_income).toBeNull()
  })
})

describe('formatCensusValue', () => {
  it('renders null as em-dash regardless of format', () => {
    expect(formatCensusValue(null, 'integer')).toBe('—')
    expect(formatCensusValue(null, 'percent')).toBe('—')
    expect(formatCensusValue(null, 'currency')).toBe('—')
    expect(formatCensusValue(null, 'decimal')).toBe('—')
  })

  it('formats integers with thousands separators', () => {
    expect(formatCensusValue(12345, 'integer')).toBe('12,345')
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

describe('formatAcsDatasetLabel', () => {
  it('parses standard Transitland dataset names', () => {
    expect(formatAcsDatasetLabel('acsdt5y2021')).toBe('ACS 5-year 2021')
    expect(formatAcsDatasetLabel('acsdt1y2022')).toBe('ACS 1-year 2022')
  })

  it('falls back to raw string on unknown format', () => {
    expect(formatAcsDatasetLabel('something-else')).toBe('something-else')
  })

  it('returns empty string for missing input', () => {
    expect(formatAcsDatasetLabel(undefined)).toBe('')
    expect(formatAcsDatasetLabel('')).toBe('')
  })
})
