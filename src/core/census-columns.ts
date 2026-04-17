/**
 * Catalogue of ACS demographic columns surfaced in aggregation tables and the
 * map view. See issue #302.
 *
 * All ACS column IDs used by derivations are declared at the top of this file
 * so the full source mapping is auditable in one place. Derivations below
 * reference these constants rather than hardcoding column IDs inline.
 *
 * Column ID format: lowercase `<table>_<col>`, e.g. `b01001_001`. Matches
 * the `tableDatasetTableCol` format used by WSDOTReportConfig and the
 * Transitland GraphQL `values` payload.
 *
 * Derivations return `null` when required inputs are missing or a denominator
 * is zero, so the UI can render "—" instead of bogus zeros. The backend may
 * have not yet loaded some of these tables; `values` will be sparse in that
 * case and derivations will naturally return `null`.
 */

// =============================================================================
// ACS column ID mapping. Audit here — do not bury column IDs inline in derives.
// =============================================================================

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

// B25008 — Total population in occupied housing units by tenure
// NOTE: issue #302 spec uses B25008 for "% rental households". B25008 is a
// population count, not a household count, so this ratio mixes units. Kept
// per-spec until Thomas confirms — may want B25003_003/B25003_001 instead.
const B25008_RENTER_OCCUPIED = 'b25008_003'

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

// B23024 — Poverty status × disability × employment (ages 18-64)
// Best-effort per issue #302: sum "with a disability" counts from the
// below-poverty and at/above-poverty branches. Exact column offsets should be
// spot-checked against the ACS codebook once data is loaded on prod.
const B23024_DISABILITY_COLS = [
  'b23024_003', // Below poverty, with a disability
  'b23024_019', // At or above poverty, with a disability
]

// =============================================================================
// Column definitions
// =============================================================================

export type CensusValues = Record<string, number | undefined>
export type CensusFormat = 'integer' | 'percent' | 'currency' | 'decimal'

export interface CensusColumnDef {
  id: string
  label: string
  format: CensusFormat
  requiredTables: string[]
  derive: (values: CensusValues) => number | null
  /**
   * When true, the map choropleth may shade this column as a density
   * (value / area_km²) rather than as a raw value. Applies to additive
   * count-type columns (population, commuters, age bins, disability counts)
   * where dividing by area is meaningful. Does NOT apply to ratios,
   * currency, or non-additive columns like medians — those stay as raw
   * values regardless of the user's density toggle.
   *
   * Declared explicitly on each column rather than inferred from `format`
   * because format/type is a brittle proxy (an integer column isn't
   * automatically a spatially-meaningful count).
   */
  densityEligible: boolean
  /**
   * Human-readable formula rendered in the census-details "Derivation
   * inspector" tab (#302 debug view). Keep this in sync with the `derive`
   * function — it documents the same math for people.
   */
  formula: string
  /**
   * The raw ACS column IDs that `derive` reads from. Used by the
   * derivation inspector to display per-geography input values alongside
   * the formula. Declared explicitly so the inspector doesn't have to
   * introspect the derive function.
   */
  sourceColumns: string[]
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
    densityEligible: true,
    formula: B01003_TOTAL,
    sourceColumns: [B01003_TOTAL],
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
    densityEligible: false,
    formula: `(${B01003_TOTAL} − ${B02001_WHITE_ALONE}) / ${B01003_TOTAL}`,
    sourceColumns: [B01003_TOTAL, B02001_WHITE_ALONE],
  },
  {
    id: 'public_transit_commuters',
    label: 'Public transit commuters',
    format: 'integer',
    requiredTables: ['b08301'],
    derive: v => num(v[B08301_PUBLIC_TRANSIT]),
    densityEligible: true,
    formula: B08301_PUBLIC_TRANSIT,
    sourceColumns: [B08301_PUBLIC_TRANSIT],
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
    densityEligible: false,
    formula: `(${B25044_OWNER_NO_VEHICLE} + ${B25044_RENTER_NO_VEHICLE}) / ${B25044_TOTAL}`,
    sourceColumns: [B25044_TOTAL, B25044_OWNER_NO_VEHICLE, B25044_RENTER_NO_VEHICLE],
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
    densityEligible: false,
    formula: `(${C17002_TOTAL} − ${C17002_AT_OR_ABOVE_200_PCT}) / ${C17002_TOTAL}`,
    sourceColumns: [C17002_TOTAL, C17002_AT_OR_ABOVE_200_PCT],
  },
  {
    id: 'median_household_income',
    label: 'Median household income',
    format: 'currency',
    requiredTables: ['b19013'],
    derive: v => num(v[B19013_MEDIAN_INCOME]),
    densityEligible: false,
    formula: B19013_MEDIAN_INCOME,
    sourceColumns: [B19013_MEDIAN_INCOME],
  },
  {
    id: 'avg_household_size',
    label: 'Average household size',
    format: 'decimal',
    requiredTables: ['b01003', 'b25002'],
    derive: v => ratio(num(v[B01003_TOTAL]), num(v[B25002_OCCUPIED])),
    densityEligible: false,
    formula: `${B01003_TOTAL} / ${B25002_OCCUPIED}`,
    sourceColumns: [B01003_TOTAL, B25002_OCCUPIED],
  },
  {
    id: 'pct_rental_households',
    label: '% Rental households',
    format: 'percent',
    requiredTables: ['b25002', 'b25008'],
    derive: v => ratio(num(v[B25008_RENTER_OCCUPIED]), num(v[B25002_OCCUPIED])),
    densityEligible: false,
    formula: `${B25008_RENTER_OCCUPIED} / ${B25002_OCCUPIED}`,
    sourceColumns: [B25008_RENTER_OCCUPIED, B25002_OCCUPIED],
  },
  {
    id: 'youth_under_18',
    label: 'Youth under 18',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, B01001_YOUTH_UNDER_18),
    densityEligible: true,
    formula: `sum(${B01001_YOUTH_UNDER_18.join(', ')})`,
    sourceColumns: B01001_YOUTH_UNDER_18,
  },
  {
    id: 'adults_65_plus',
    label: 'Adults 65 and over',
    format: 'integer',
    requiredTables: ['b01001'],
    derive: v => sum(v, B01001_ADULTS_65_PLUS),
    densityEligible: true,
    formula: `sum(${B01001_ADULTS_65_PLUS.join(', ')})`,
    sourceColumns: B01001_ADULTS_65_PLUS,
  },
  {
    id: 'working_age_with_disability',
    label: 'Working-age adults with a disability',
    format: 'integer',
    requiredTables: ['b23024'],
    derive: v => sum(v, B23024_DISABILITY_COLS),
    densityEligible: true,
    formula: `sum(${B23024_DISABILITY_COLS.join(', ')})`,
    sourceColumns: B23024_DISABILITY_COLS,
  },
]

/**
 * Union of all ACS table names required to compute every column. Use this as
 * the `tableNames` argument to the census intersection query.
 */
export const REQUIRED_ACS_TABLES: string[] = Array.from(
  new Set(CENSUS_COLUMNS.flatMap(c => c.requiredTables)),
).sort()

/**
 * Render an area in m² as a human-readable string. Uses km² once values are
 * ≥ 1 km² (1,000,000 m²); otherwise stays in m². Rounds to 2 decimal places
 * for km² and to whole m².
 */
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

/**
 * Render a Transitland ACS dataset name as a human-readable label.
 * Examples: `acsdt5y2021` → "ACS 5-year 2021"; `acsdt1y2022` → "ACS 1-year 2022".
 * Unknown formats fall back to the raw string.
 */
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

/**
 * Render a choropleth bucket label for a palette of `n` colors paired with
 * `n-1` monotonically increasing break values. Index 0 is "<= first break",
 * the last index is ">= last break", and the middle buckets are "a to b".
 * Used by the map legend (#302).
 */
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

/**
 * Derive a census row apportioned by an area intersection ratio (used for
 * the census panel's "Intersection" column, #302).
 *
 * Semantics:
 *   - Additive count columns (population, commuters, etc.) are scaled by
 *     the ratio: `derive(values * ratio)`.
 *   - Ratio columns (% POC, % rental, ...) are unchanged — scaling numerator
 *     and denominator by the same factor cancels out.
 *   - Non-additive columns (listed in `NON_ADDITIVE_CENSUS_COLUMNS`, e.g.
 *     median income) are carried through as the full-geography value; an
 *     area-apportioned median is not meaningful.
 */
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

/**
 * Sum raw ACS values across a collection of geographies, apportioning each
 * geography's values by its intersection ratio. Returns a `{ raw, derived }`
 * pair: `raw` is the summed values object, and `derived` is the per-column
 * result of running each `CensusColumnDef.derive` over it.
 *
 * Non-additive metrics (medians) produce meaningful values only when the
 * underlying components are additive — the caller should render
 * `median_household_income` as "—" for the summary column.
 *
 * Used by the census panel's "All Geographies" column (#302).
 */
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

/**
 * Columns that are not additive across geographies. The bounding-box summary
 * column in the census panel renders these as "—" because a
 * population-weighted sum is nonsense for a median.
 */
export const NON_ADDITIVE_CENSUS_COLUMNS = new Set<string>([
  'median_household_income',
])

/**
 * Choropleth classification shared between the map page (which builds it
 * from the aggregated rows) and the legend (which renders buckets from it).
 * Lives in core so the component files that consume it aren't importing
 * types across component boundaries.
 */
export interface ChoroplethClassification {
  element: string
  label: string
  format: CensusFormat
  palette: readonly string[]
  values: number[]
  breaks: number[]
  hasInsufficient: boolean
  /** When true, `values`/`breaks` are counts per km² (not raw counts). The
   * legend heading and bucket labels annotate the unit accordingly. */
  isDensity: boolean
}
