import { gql } from 'graphql-tag'
import type { GraphQLClient } from '~~/src/core'

// NTD Mode to VisionEval mode mapping
// Per issue #260: Only these specific modes are used in VisionEval modeling
// Any NTD modes not listed should be IGNORED (not mapped)
const NTD_TO_VISIONEVAL_MODE: Record<string, string> = {
  DR: 'DR', // Demand Response
  VP: 'VP', // Vanpool
  MB: 'MB', // Bus
  CB: 'RB', // Commuter Bus -> Bus Rapid Transit
  MG: 'MG', // Monorail/Automated Guideway
  SR: 'SR', // Streetcar Rail
  TB: 'SR', // Trolleybus -> Streetcar Rail
  HR: 'HR', // Heavy Rail
  LR: 'HR', // Light Rail -> Heavy Rail
  CR: 'CR', // Commuter Rail
}

const VISIONEVAL_MODE_NAMES: Record<string, string> = {
  DR: 'Demand Response',
  VP: 'Vanpool',
  MB: 'Bus',
  RB: 'Bus Rapid Transit',
  MG: 'Monorail/Automated Guideway',
  SR: 'Streetcar Rail',
  HR: 'Heavy Rail',
  CR: 'Commuter Rail',
}

// Configuration for VisionEval analysis
// Per issue #260: "only one year and State will be chosen at a time"
export interface VisionEvalConfig {
  state: string // State abbreviation (e.g., "WA", "CA")
  year: number // Single report year
}

// Raw NTD value from GraphQL
export interface NTDMetricValue {
  geoid: string // Format: ntd:{ntd_id}:{year}:{mode}:{tos}
  dataset_name: string
  values: {
    agency?: string
    city?: string
    state?: string
    uza_name?: string
    mode_name?: string
    vehicle_revenue_miles?: number
    vehicle_revenue_miles_1?: number // questionable flag
    total_operating_expenses?: number
    total_operating_expenses_1?: number // questionable flag
    [key: string]: any
  }
}

// Processed NTD record after parsing geoid
export interface NTDRecord {
  ntdId: string
  year: number
  mode: string // Original NTD mode
  typeOfService: string
  agency: string
  state: string
  uzaName: string
  modeName: string
  vehicleRevenueMiles: number
  totalOperatingExpenses: number
}

// marea_transit_service.csv row
export interface MareaTransitServiceRow {
  Geo: string // UZA name
  Year: number
  DRRevMi: number
  VPRevMi: number
  MBRevMi: number
  RBRevMi: number
  MGRevMi: number
  SRRevMi: number
  HRRevMi: number
  CRRevMi: number
}

// cost_per_revenue_mile.csv row (per issue #260 spec)
export interface CostPerRevenueMileRow {
  YearOfDollars: number
  Mode: string
  CostPerRevenueMile: number
}

// Summary statistics for display
export interface VisionEvalSummary {
  state: string
  year: number
  totalAgencies: number
  totalUZAs: number
  totalRecords: number
}

// Full report structure
export interface VisionEvalReport {
  config: VisionEvalConfig
  summary: VisionEvalSummary
  mareaTransitService: MareaTransitServiceRow[]
  costPerRevenueMile: CostPerRevenueMileRow[]
  rawRecords: NTDRecord[] // For debugging/detailed view
}

// GraphQL query to fetch NTD census values
const ntdValuesQuery = gql`
query($first: Int, $after: String, $dataset: String!, $table: String, $geoidPrefix: String) {
  census_datasets(where: {name: $dataset}) {
    values(first: $first, after: $after, where: {
      table: $table,
      geoid_prefix: $geoidPrefix
    }) {
      edges {
        node {
          geoid
          dataset_name
          values
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

interface NTDValuesResponse {
  census_datasets: {
    values: {
      edges: {
        node: NTDMetricValue
        cursor: string
      }[]
      pageInfo: {
        hasNextPage: boolean
        endCursor: string
      }
    }
  }[]
}

/**
 * Parse NTD geoid into components
 * Format: ntd:{ntd_id}:{year}:{mode}:{tos}
 */
function parseGeoid (geoid: string): { ntdId: string, year: number, mode: string, typeOfService: string } | null {
  const parts = geoid.split(':')
  if (parts.length !== 5 || parts[0] !== 'ntd') {
    return null
  }
  return {
    ntdId: parts[1]!,
    year: parseInt(parts[2]!, 10),
    mode: parts[3]!,
    typeOfService: parts[4]!,
  }
}

/**
 * Fetch all NTD metrics data with pagination
 */
async function fetchNTDMetrics (
  client: GraphQLClient,
  onProgress?: (count: number, hasMore: boolean) => void
): Promise<NTDMetricValue[]> {
  const allValues: NTDMetricValue[] = []
  let hasNextPage = true
  let afterCursor: string | null = null
  const pageSize = 5000

  while (hasNextPage) {
    const variables: Record<string, any> = {
      first: pageSize,
      dataset: 'ntd-annual',
      table: 'metrics',
      geoidPrefix: 'ntd:',
    }
    if (afterCursor) {
      variables.after = afterCursor
    }

    const result = await client.query<NTDValuesResponse>(ntdValuesQuery, variables)
    const dataset = result.data?.census_datasets?.[0]
    if (!dataset?.values?.edges) {
      break
    }

    for (const edge of dataset.values.edges) {
      allValues.push(edge.node)
    }

    hasNextPage = dataset.values.pageInfo.hasNextPage
    afterCursor = dataset.values.pageInfo.endCursor

    if (onProgress) {
      onProgress(allValues.length, hasNextPage)
    }
  }

  return allValues
}

/**
 * Process raw NTD values into typed records
 */
function processNTDValues (values: NTDMetricValue[], config: VisionEvalConfig): NTDRecord[] {
  const records: NTDRecord[] = []

  for (const value of values) {
    const parsed = parseGeoid(value.geoid)
    if (!parsed) {
      continue
    }

    // Filter by state
    const state = String(value.values.state || '').toUpperCase()
    if (state !== config.state.toUpperCase()) {
      continue
    }

    // Filter by year (single year per issue #260)
    if (parsed.year !== config.year) {
      continue
    }

    // Skip "Non-UZA" entries (rural areas without urbanized area designation)
    const uzaName = String(value.values.uza_name || '')
    if (uzaName.includes('Non-UZA') || uzaName === '') {
      continue
    }

    // Extract numeric values, handling potential string values
    const vehicleRevenueMiles = parseFloat(String(value.values.vehicle_revenue_miles || 0)) || 0
    const totalOperatingExpenses = parseFloat(String(value.values.total_operating_expenses || 0)) || 0

    records.push({
      ntdId: parsed.ntdId,
      year: parsed.year,
      mode: parsed.mode,
      typeOfService: parsed.typeOfService,
      agency: String(value.values.agency || ''),
      state,
      uzaName,
      modeName: String(value.values.mode_name || ''),
      vehicleRevenueMiles,
      totalOperatingExpenses,
    })
  }

  return records
}

/**
 * Generate marea_transit_service.csv data
 * Aggregates Vehicle Revenue Miles by UZA and VisionEval mode
 * Per issue #260: One row per [Report Year] and [Primary UZA Name] combination
 */
function generateMareaTransitService (records: NTDRecord[]): MareaTransitServiceRow[] {
  // Group by UZA and Year
  const uzaYearMap = new Map<string, Map<string, number>>()

  for (const record of records) {
    // Map NTD mode to VisionEval mode - skip if not in VisionEval spec
    const visionEvalMode = NTD_TO_VISIONEVAL_MODE[record.mode]
    if (!visionEvalMode) {
      continue // Skip modes not in VisionEval spec
    }

    const key = `${record.uzaName}|${record.year}`
    if (!uzaYearMap.has(key)) {
      uzaYearMap.set(key, new Map())
    }
    const modeMap = uzaYearMap.get(key)!

    const currentValue = modeMap.get(visionEvalMode) || 0
    modeMap.set(visionEvalMode, currentValue + record.vehicleRevenueMiles)
  }

  // Convert to output rows
  const rows: MareaTransitServiceRow[] = []
  for (const [key, modeMap] of uzaYearMap) {
    const [uzaName, yearStr] = key.split('|')
    rows.push({
      Geo: uzaName!,
      Year: parseInt(yearStr!, 10),
      DRRevMi: Math.round(modeMap.get('DR') || 0),
      VPRevMi: Math.round(modeMap.get('VP') || 0),
      MBRevMi: Math.round(modeMap.get('MB') || 0),
      RBRevMi: Math.round(modeMap.get('RB') || 0),
      MGRevMi: Math.round(modeMap.get('MG') || 0),
      SRRevMi: Math.round(modeMap.get('SR') || 0),
      HRRevMi: Math.round(modeMap.get('HR') || 0),
      CRRevMi: Math.round(modeMap.get('CR') || 0),
    })
  }

  // Sort by UZA name, then year
  rows.sort((a, b) => {
    const geoCompare = a.Geo.localeCompare(b.Geo)
    if (geoCompare !== 0) { return geoCompare }
    return a.Year - b.Year
  })

  return rows
}

/**
 * Generate cost_per_revenue_mile.csv data
 * Calculates statewide cost per revenue mile by VisionEval mode
 * Per issue #260: One row per [Report Year] and Mode combination
 */
function generateCostPerRevenueMile (records: NTDRecord[]): CostPerRevenueMileRow[] {
  // Group by Year and VisionEval mode
  const yearModeMap = new Map<string, { expenses: number, miles: number }>()

  for (const record of records) {
    const visionEvalMode = NTD_TO_VISIONEVAL_MODE[record.mode]
    if (!visionEvalMode) {
      continue // Skip modes not in VisionEval spec
    }
    const key = `${record.year}|${visionEvalMode}`

    if (!yearModeMap.has(key)) {
      yearModeMap.set(key, { expenses: 0, miles: 0 })
    }
    const totals = yearModeMap.get(key)!
    totals.expenses += record.totalOperatingExpenses
    totals.miles += record.vehicleRevenueMiles
  }

  // Convert to output rows (per issue #260 column spec)
  const rows: CostPerRevenueMileRow[] = []
  for (const [key, totals] of yearModeMap) {
    const [yearStr, mode] = key.split('|')
    const costPerRevenueMile = totals.miles > 0 ? totals.expenses / totals.miles : 0
    rows.push({
      YearOfDollars: parseInt(yearStr!, 10),
      Mode: mode!,
      CostPerRevenueMile: Math.round(costPerRevenueMile * 100) / 100, // Round to 2 decimal places
    })
  }

  // Sort by year, then mode
  rows.sort((a, b) => {
    const yearCompare = a.YearOfDollars - b.YearOfDollars
    if (yearCompare !== 0) { return yearCompare }
    return a.Mode.localeCompare(b.Mode)
  })

  return rows
}

/**
 * Main analysis function - runs the VisionEval NTD analysis
 */
export async function runVisionEvalAnalysis (
  config: VisionEvalConfig,
  client: GraphQLClient,
  onProgress?: (message: string, count?: number) => void
): Promise<VisionEvalReport> {
  // Fetch all NTD metrics data
  onProgress?.('Fetching NTD metrics data...', 0)
  const rawValues = await fetchNTDMetrics(client, (count, hasMore) => {
    onProgress?.(`Fetching NTD metrics data... ${count} records${hasMore ? ' (loading more)' : ' (complete)'}`, count)
  })

  // Process and filter records
  onProgress?.('Processing and filtering records...', rawValues.length)
  const records = processNTDValues(rawValues, config)

  // Generate output tables
  onProgress?.('Generating marea_transit_service table...', records.length)
  const mareaTransitService = generateMareaTransitService(records)

  onProgress?.('Generating cost_per_revenue_mile table...', records.length)
  const costPerRevenueMile = generateCostPerRevenueMile(records)

  // Calculate summary statistics
  const uniqueAgencies = new Set(records.map(r => r.ntdId))
  const uniqueUZAs = new Set(records.map(r => r.uzaName))

  const summary: VisionEvalSummary = {
    state: config.state,
    year: config.year,
    totalAgencies: uniqueAgencies.size,
    totalUZAs: uniqueUZAs.size,
    totalRecords: records.length,
  }

  onProgress?.('Analysis complete!', records.length)

  return {
    config,
    summary,
    mareaTransitService,
    costPerRevenueMile,
    rawRecords: records,
  }
}

// Export mode mappings for UI use
export { NTD_TO_VISIONEVAL_MODE, VISIONEVAL_MODE_NAMES }
