/**
 * Catalogue of ACS demographic columns surfaced in aggregation tables and the
 * map view. See issue #302. Each entry declares the ACS tables it needs, plus
 * a derivation from a flat `values` map keyed by lowercase `<table>_<col>`
 * (matching the WSDOTReportConfig.tableDatasetTableCol format, e.g.
 * `b01001_001`).
 *
 * Derivations return `null` when required inputs are missing or a denominator
 * is zero, so the UI can render "—" instead of bogus zeros. The backend may
 * have not yet loaded some of these tables; in that case `values` will be
 * sparse and derivations will naturally return `null`.
 */

export type CensusValues = Record<string, number | undefined>
export type CensusFormat = 'integer' | 'percent' | 'currency' | 'decimal'

export interface CensusColumnDef {
  id: string
  label: string
  format: CensusFormat
  requiredTables: string[]
  derive: (values: CensusValues) => number | null
}

function num (v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function ratio (numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) {
    return null
  }
  return numerator / denominator
}

function sum (values: CensusValues, keys: string[]): number | null {
  let total = 0
  let sawAny = false
  for (const k of keys) {
    const v = values[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v
      sawAny = true
    }
  }
  return sawAny ? total : null
}

const YOUTH_KEYS = [
  'b01001_003', 'b01001_004', 'b01001_005', 'b01001_006',
  'b01001_027', 'b01001_028', 'b01001_029', 'b01001_030',
]

const OLDER_ADULT_KEYS = [
  'b01001_020', 'b01001_021', 'b01001_022', 'b01001_023', 'b01001_024', 'b01001_025',
  'b01001_044', 'b01001_045', 'b01001_046', 'b01001_047', 'b01001_048', 'b01001_049',
]

export const CENSUS_COLUMNS: CensusColumnDef[] = [
  {
    id: 'total_population',
    label: 'Total population',
    format: 'integer',
    requiredTables: ['b01003'],
    derive: v => num(v['b01003_001']),
  },
  {
    id: 'pct_people_of_color',
    label: '% People of color',
    format: 'percent',
    requiredTables: ['b01003', 'b02001'],
    derive: (v) => {
      const total = num(v['b01003_001'])
      const white = num(v['b02001_002'])
      if (total === null || white === null) {
        return null
      }
      return ratio(total - white, total)
    },
  },
  {
    id: 'public_transit_commuters',
    label: 'Public transit commuters',
    format: 'integer',
    requiredTables: ['b08301'],
    derive: v => num(v['b08301_010']),
  },
  {
    id: 'pct_no_vehicle',
    label: '% Households with no vehicle',
    format: 'percent',
    requiredTables: ['b25044'],
    // (owner no-vehicle + renter no-vehicle) / total occupied
    derive: (v) => {
      const total = num(v['b25044_001'])
      const ownerNone = num(v['b25044_003'])
      const renterNone = num(v['b25044_010'])
      if (ownerNone === null && renterNone === null) {
        return null
      }
      return ratio((ownerNone ?? 0) + (renterNone ?? 0), total)
    },
  },
  {
    id: 'pct_below_200_poverty',
    label: '% Households below 200% of poverty line',
    format: 'percent',
    requiredTables: ['c17002'],
    // (total − at-or-above-200%) / total
    derive: (v) => {
      const total = num(v['c17002_001'])
      const atOrAbove = num(v['c17002_008'])
      if (total === null || atOrAbove === null) {
        return null
      }
      return ratio(total - atOrAbove, total)
    },
  },
  {
    id: 'median_household_income',
    label: 'Median household income',
    format: 'currency',
    requiredTables: ['b19013'],
    derive: v => num(v['b19013_001']),
  },
  {
    id: 'avg_household_size',
    label: 'Average household size',
    format: 'decimal',
    requiredTables: ['b01003', 'b25002'],
    derive: v => ratio(num(v['b01003_001']), num(v['b25002_002'])),
  },
  {
    id: 'pct_rental_households',
    label: '% Rental households',
    format: 'percent',
    requiredTables: ['b25002', 'b25008'],
    // Per issue #302 text: "Renter occupied (B25008) / Occupied units (B25002)".
    // Units mismatch (B25008 is population, B25002 is units); following spec
    // literally — revisit if Tim confirms he meant B25003.
    derive: v => ratio(num(v['b25008_003']), num(v['b25002_002'])),
  },
  {
    id: 'youth_under_18',
    label: 'Youth under 18',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, YOUTH_KEYS),
  },
  {
    id: 'adults_65_plus',
    label: 'Adults 65 and over',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, OLDER_ADULT_KEYS),
  },
  {
    id: 'working_age_with_disability',
    label: 'Working-age adults with a disability',
    format: 'integer',
    requiredTables: ['b23024'],
    // Sum of with-disability counts across below-poverty and at/above branches
    // of B23024. Per issue #302: "this can't be the best stat or way to
    // calculate it" — best-effort pending a better source.
    derive: v => sum(v, ['b23024_003', 'b23024_019']),
  },
]

/**
 * Union of all ACS table names required to compute every column. Use this as
 * the `tableNames` argument to the census intersection query.
 */
export const REQUIRED_ACS_TABLES: string[] = Array.from(
  new Set(CENSUS_COLUMNS.flatMap(c => c.requiredTables)),
).sort()

export function formatCensusValue (value: number | null, format: CensusFormat): string {
  if (value === null || !Number.isFinite(value)) {
    return '—'
  }
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString('en-US')
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
    case 'currency':
      return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    case 'decimal':
      return value.toFixed(2)
  }
}

export function deriveCensusRow (values: CensusValues): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    out[col.id] = col.derive(values)
  }
  return out
}
