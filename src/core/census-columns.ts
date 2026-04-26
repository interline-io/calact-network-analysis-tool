// ACS demographic columns surfaced in aggregation tables and the map view (#302).
// Column ID format: lowercase `<table>_<col>` (e.g. `b01001_001`). Derivations
// return null when inputs are missing or denominators are zero so the UI can
// render "—" instead of misleading zeros.

// B01003 — Total population
const B01003_TOTAL = 'b01003_001'

// B02001 — Race
const B02001_WHITE_ALONE = 'b02001_002'

// B08301 — Means of transportation to work
const B08301_PUBLIC_TRANSIT = 'b08301_010'

// B19013 — Median household income in the past 12 months
const B19013_MEDIAN_INCOME = 'b19013_001'

// B25002 — Occupancy status
const B25002_OCCUPIED = 'b25002_002'

// B25003 — Tenure (household counts; not B25008 which is population —
// using B25008 as numerator over an HH-unit denominator produces ratios >100%)
const B25003_TOTAL = 'b25003_001'
const B25003_RENTER_OCCUPIED = 'b25003_003'

// B25044 — Tenure by vehicles available
const B25044_TOTAL = 'b25044_001'
const B25044_OWNER_NO_VEHICLE = 'b25044_003'
const B25044_RENTER_NO_VEHICLE = 'b25044_010'

// C17002 — Ratio of income to poverty level in the past 12 months
const C17002_TOTAL = 'c17002_001'
const C17002_AT_OR_ABOVE_200_PCT = 'c17002_008'

// B01001 — Sex by age. Youth (<18) and older adults (65+) summed across M+F.
const B01001_YOUTH_UNDER_18 = [
  // Male: under 5, 5-9, 10-14, 15-17
  'b01001_003', 'b01001_004', 'b01001_005', 'b01001_006',
  // Female: under 5, 5-9, 10-14, 15-17
  'b01001_027', 'b01001_028', 'b01001_029', 'b01001_030',
]

const B01001_ADULTS_65_PLUS = [
  // Male: 65-66, 67-69, 70-74, 75-79, 80-84, 85+
  'b01001_020', 'b01001_021', 'b01001_022', 'b01001_023', 'b01001_024', 'b01001_025',
  // Female: 65-66, 67-69, 70-74, 75-79, 80-84, 85+
  'b01001_044', 'b01001_045', 'b01001_046', 'b01001_047', 'b01001_048', 'b01001_049',
]

// B23024 — Poverty status × disability × employment (ages 18-64).
// Best-effort: spot-check against the ACS codebook once prod data is loaded.
const B23024_DISABILITY_COLS = [
  'b23024_003', // Below poverty, with a disability
  'b23024_019', // At or above poverty, with a disability
]

export type CensusValues = Record<string, number | undefined>
export type CensusFormat = 'integer' | 'percent' | 'currency' | 'decimal'

export interface CensusColumnDef {
  id: string
  label: string
  format: CensusFormat
  requiredTables: string[]
  derive: (values: CensusValues) => number | null
  // True for additive count columns where shading by value/km² is meaningful.
  // Declared per-column because format alone is too coarse a signal.
  densityEligible: boolean
}

// Coerce arbitrary input to a finite number, or null. Accepts numeric
// strings, rejects NaN/Infinity. Used by the datagrid, census-panel, and
// census-details for cell-value normalization.
export function toFiniteNumber (value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (value === null || value === undefined) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
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

export const CENSUS_COLUMNS: CensusColumnDef[] = [
  {
    id: 'total_population',
    label: 'Total population',
    format: 'integer',
    requiredTables: ['b01003'],
    derive: v => num(v[B01003_TOTAL]),
    densityEligible: true
  },
  {
    id: 'pct_people_of_color',
    label: '% People of color',
    format: 'percent',
    requiredTables: ['b01003', 'b02001'],
    derive: (v) => {
      const total = num(v[B01003_TOTAL])
      const white = num(v[B02001_WHITE_ALONE])
      if (total === null || white === null) {
        return null
      }
      return ratio(total - white, total)
    },
    densityEligible: false
  },
  {
    id: 'public_transit_commuters',
    label: 'Public transit commuters',
    format: 'integer',
    requiredTables: ['b08301'],
    derive: v => num(v[B08301_PUBLIC_TRANSIT]),
    densityEligible: true
  },
  {
    id: 'pct_no_vehicle',
    label: '% Households with no vehicle',
    format: 'percent',
    requiredTables: ['b25044'],
    derive: (v) => {
      const total = num(v[B25044_TOTAL])
      const ownerNone = num(v[B25044_OWNER_NO_VEHICLE])
      const renterNone = num(v[B25044_RENTER_NO_VEHICLE])
      if (ownerNone === null && renterNone === null) {
        return null
      }
      return ratio((ownerNone ?? 0) + (renterNone ?? 0), total)
    },
    densityEligible: false
  },
  {
    id: 'pct_below_200_poverty',
    label: '% Households below 200% of poverty line',
    format: 'percent',
    requiredTables: ['c17002'],
    derive: (v) => {
      const total = num(v[C17002_TOTAL])
      const atOrAbove = num(v[C17002_AT_OR_ABOVE_200_PCT])
      if (total === null || atOrAbove === null) {
        return null
      }
      return ratio(total - atOrAbove, total)
    },
    densityEligible: false
  },
  {
    id: 'median_household_income',
    label: 'Median household income',
    format: 'currency',
    requiredTables: ['b19013'],
    derive: v => num(v[B19013_MEDIAN_INCOME]),
    densityEligible: false
  },
  {
    id: 'avg_household_size',
    label: 'Average household size',
    format: 'decimal',
    requiredTables: ['b01003', 'b25002'],
    derive: v => ratio(num(v[B01003_TOTAL]), num(v[B25002_OCCUPIED])),
    densityEligible: false
  },
  {
    id: 'pct_rental_households',
    label: '% Rental households',
    format: 'percent',
    requiredTables: ['b25003'],
    derive: v => ratio(num(v[B25003_RENTER_OCCUPIED]), num(v[B25003_TOTAL])),
    densityEligible: false
  },
  {
    id: 'youth_under_18',
    label: 'Youth under 18',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, B01001_YOUTH_UNDER_18),
    densityEligible: true
  },
  {
    id: 'adults_65_plus',
    label: 'Adults 65 and over',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, B01001_ADULTS_65_PLUS),
    densityEligible: true
  },
  {
    id: 'working_age_with_disability',
    label: 'Working-age adults with a disability',
    format: 'integer',
    requiredTables: ['b23024'],
    derive: v => sum(v, B23024_DISABILITY_COLS),
    densityEligible: true
  },
]

export const REQUIRED_ACS_TABLES: string[] = Array.from(
  new Set(CENSUS_COLUMNS.flatMap(c => c.requiredTables)),
).sort()

// Discover the raw ACS keys a `derive` reads by invoking it with a
// recording Proxy. Run with two finite, non-zero sentinels so threshold
// branches in derive (`if (v[X] > 100) return v[Y]`) still register both
// sides. Derivations must access keys via literal indexing — no looping
// over Object.keys(values).
export function detectCensusColumnSourceKeys (col: CensusColumnDef): string[] {
  const seen = new Set<string>()
  const makeProxy = (sentinel: number) => new Proxy({} as CensusValues, {
    get (_target, key) {
      if (typeof key === 'string') { seen.add(key) }
      return sentinel
    },
  })
  for (const sentinel of [1, 1_000_000_000]) {
    try {
      col.derive(makeProxy(sentinel))
    } catch {
      // ignore — only the keys touched before the throw matter
    }
  }
  return [...seen].sort()
}

// Switches to km² at 1,000,000 m².
export function formatArea (m2: number | null | undefined): string {
  if (m2 === null || m2 === undefined || !Number.isFinite(m2)) {
    return '—'
  }
  if (m2 >= 1_000_000) {
    return `${(m2 / 1_000_000).toFixed(2)} km²`
  }
  return `${Math.round(m2).toLocaleString('en-US')} m²`
}

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

// `acsdt5y2021` → "ACS 5-year 2021". Unknown formats pass through.
export function formatAcsDatasetLabel (datasetName: string | undefined): string {
  if (!datasetName) {
    return ''
  }
  const m = /^acsdt(\d+)y(\d{4})$/.exec(datasetName)
  if (!m) {
    return datasetName
  }
  return `ACS ${m[1]}-year ${m[2]}`
}

// Bucket label for `n` palette colors and `n-1` increasing breaks.
// First bucket: "<= breaks[0]"; last: ">= breaks[-1]"; middle: "a to b".
export function formatCensusBucketLabel (
  index: number,
  breaks: number[],
  paletteLength: number,
  format: CensusFormat,
): string {
  if (breaks.length === 0 || paletteLength <= 1) {
    return ''
  }
  const fmt = (v: number) => formatCensusValue(v, format)
  if (index === 0) {
    return `${fmt(breaks[0]!)} or less`
  }
  if (index >= paletteLength - 1) {
    const last = breaks[breaks.length - 1]
    if (last === undefined) {
      return ''
    }
    return `${fmt(last)} or greater`
  }
  const lo = breaks[index - 1]
  const hi = breaks[index]
  if (lo === undefined || hi === undefined) {
    return ''
  }
  return `${fmt(lo)} to ${fmt(hi)}`
}

export function deriveCensusRow (values: CensusValues): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    out[col.id] = col.derive(values)
  }
  return out
}

// Counts are scaled by `intersectionRatio`; ratio columns are unchanged
// (cancels out); `NON_ADDITIVE_CENSUS_COLUMNS` (medians) read through as
// the full-geography value.
export function deriveApportionedRow (
  values: CensusValues,
  intersectionRatio: number,
): Record<string, number | null> {
  const scaled: CensusValues = {}
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      scaled[k] = v * intersectionRatio
    }
  }
  const out: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    out[col.id] = NON_ADDITIVE_CENSUS_COLUMNS.has(col.id)
      ? col.derive(values)
      : col.derive(scaled)
  }
  return out
}

// Same semantics as `deriveApportionedRow` but for a single column. Avoids
// running the other 10 derivations on the per-feature hot path; only scales
// the keys this column actually reads. Source keys are memoized lazily via
// `detectCensusColumnSourceKeys`.
const SOURCE_KEYS_CACHE = new Map<string, string[]>()

export function deriveApportionedColumn (
  values: CensusValues,
  intersectionRatio: number,
  columnId: string,
): number | null {
  const col = CENSUS_COLUMNS.find(c => c.id === columnId)
  if (!col) {
    return null
  }
  if (NON_ADDITIVE_CENSUS_COLUMNS.has(columnId)) {
    return col.derive(values)
  }
  let keys = SOURCE_KEYS_CACHE.get(columnId)
  if (!keys) {
    keys = detectCensusColumnSourceKeys(col)
    SOURCE_KEYS_CACHE.set(columnId, keys)
  }
  const scaled: CensusValues = {}
  for (const k of keys) {
    const v = values[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      scaled[k] = v * intersectionRatio
    }
  }
  return col.derive(scaled)
}

// Sum apportioned raw ACS values across geographies, then run derivations.
// Non-additive columns (medians) come out as nonsense — callers must render
// `NON_ADDITIVE_CENSUS_COLUMNS` as "—".
export function summarizeBbox (
  geoids: Iterable<string>,
  geographies: Map<string, { values: CensusValues, intersectionRatio: number }> | undefined,
): { raw: Record<string, number>, derived: Record<string, number | null> } {
  const raw: Record<string, number> = {}
  if (!geographies) {
    return { raw, derived: {} }
  }
  for (const geoid of geoids) {
    const geo = geographies.get(geoid)
    if (!geo) {
      continue
    }
    const ratio = geo.intersectionRatio
    for (const [key, v] of Object.entries(geo.values)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        continue
      }
      raw[key] = (raw[key] ?? 0) + v * ratio
    }
  }
  const derived: Record<string, number | null> = {}
  for (const col of CENSUS_COLUMNS) {
    derived[col.id] = col.derive(raw)
  }
  return { raw, derived }
}

// Columns that can't be summed across geographies (medians).
export const NON_ADDITIVE_CENSUS_COLUMNS = new Set<string>([
  'median_household_income',
])
