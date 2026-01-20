import type { GraphQLClient } from '~~/src/core'
import { GenericStreamSender, requestStream, type StreamableProgress } from '~~/src/core/stream'
import { fetchNTDData, type NTDRawValue } from '~~/src/analysis/ntd'

// Default NTD census dataset and table configuration
const NTD_DEFAULTS = {
  dataset: 'ntd-annual-2024',
  table: 'service_data_and_operating_expenses_by_mode',
  fields: {
    ntdId: 'ntd_id',
    reportYear: 'report_year',
    mode: 'mode',
    typeOfService: 'type_of_service',
    vehicleRevenueMiles: 'Vehicle Revenue Miles',
    totalOperatingExpenses: 'Operating Expenses',
    agency: 'agency_name',
    state: 'state',
    uzaName: 'primary_uza_name',
  },
}

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
  // NTD data source configuration (with defaults)
  ntdDataset?: string
  ntdTable?: string
  ntdFields?: {
    ntdId?: string
    reportYear?: string
    mode?: string
    typeOfService?: string
    vehicleRevenueMiles?: string
    totalOperatingExpenses?: string
    agency?: string
    state?: string
    uzaName?: string
  }
}

// Raw NTD value from GraphQL
export interface NTDMetricValue {
  geoid: string // Format: ntd:{ntd_id}:{year}:{mode}:{tos}
  dataset_name: string
  values: Record<string, any>
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

// Streaming progress for BFF endpoint
export interface VisionEvalProgress extends StreamableProgress {
  isLoading: boolean
  currentStage: 'ready' | 'fetching' | 'processing' | 'complete' | 'error'
  message?: string
  fetchedCount?: number
  filteredCount?: number
  report?: VisionEvalReport
  error?: any
}

/**
 * Process raw NTD values into typed records
 * This is used both by the old client-side path and the new BFF path
 */
function processNTDValues (values: NTDRawValue[], config: VisionEvalConfig): NTDRecord[] {
  const records: NTDRecord[] = []

  // Resolve field names with defaults
  const fields = {
    ntdId: config.ntdFields?.ntdId ?? NTD_DEFAULTS.fields.ntdId,
    reportYear: config.ntdFields?.reportYear ?? NTD_DEFAULTS.fields.reportYear,
    mode: config.ntdFields?.mode ?? NTD_DEFAULTS.fields.mode,
    typeOfService: config.ntdFields?.typeOfService ?? NTD_DEFAULTS.fields.typeOfService,
    vehicleRevenueMiles: config.ntdFields?.vehicleRevenueMiles ?? NTD_DEFAULTS.fields.vehicleRevenueMiles,
    totalOperatingExpenses: config.ntdFields?.totalOperatingExpenses ?? NTD_DEFAULTS.fields.totalOperatingExpenses,
    agency: config.ntdFields?.agency ?? NTD_DEFAULTS.fields.agency,
    state: config.ntdFields?.state ?? NTD_DEFAULTS.fields.state,
    uzaName: config.ntdFields?.uzaName ?? NTD_DEFAULTS.fields.uzaName,
  }

  for (const value of values) {
    // Get values from table fields
    const ntdId = String(value.values[fields.ntdId] || '')
    const reportYear = parseInt(String(value.values[fields.reportYear] || 0), 10)
    const mode = String(value.values[fields.mode] || '')
    const typeOfService = String(value.values[fields.typeOfService] || '')

    // State and year are already filtered by NTD fetcher, but validate
    const state = String(value.values[fields.state] || '').toUpperCase()
    const uzaName = String(value.values[fields.uzaName] || '')

    // Extract numeric values, handling potential string values
    const vehicleRevenueMiles = parseFloat(String(value.values[fields.vehicleRevenueMiles] || 0)) || 0
    const totalOperatingExpenses = parseFloat(String(value.values[fields.totalOperatingExpenses] || 0)) || 0

    records.push({
      ntdId,
      year: reportYear,
      mode,
      typeOfService,
      agency: String(value.values[fields.agency] || ''),
      state,
      uzaName,
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
 * Generate the VisionEval report from filtered NTD records
 */
export function generateVisionEvalReport (
  records: NTDRecord[],
  config: VisionEvalConfig
): VisionEvalReport {
  const mareaTransitService = generateMareaTransitService(records)
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

  return {
    config,
    summary,
    mareaTransitService,
    costPerRevenueMile,
    rawRecords: records,
  }
}

/**
 * Run VisionEval analysis with streaming support for BFF endpoint
 * This is the server-side entry point that uses the NTD fetcher
 */
export async function runVisionEvalAnalysisStreaming (
  controller: ReadableStreamDefaultController,
  config: VisionEvalConfig,
  client: GraphQLClient
): Promise<VisionEvalReport> {
  const stream = requestStream(controller)
  const writer = stream.getWriter()
  const sender = new GenericStreamSender<VisionEvalProgress>(writer)

  try {
    // Send initial progress
    sender.onProgress({
      isLoading: true,
      currentStage: 'ready',
      message: 'Initializing VisionEval analysis...',
    })

    // Fetch NTD data with server-side filtering
    sender.onProgress({
      isLoading: true,
      currentStage: 'fetching',
      message: 'Fetching NTD data...',
      fetchedCount: 0,
      filteredCount: 0,
    })

    const dataset = config.ntdDataset ?? NTD_DEFAULTS.dataset
    const table = config.ntdTable ?? NTD_DEFAULTS.table

    const filteredValues = await fetchNTDData(
      client,
      { dataset, table },
      {
        state: config.state,
        year: config.year,
        excludeNonUZA: true,
      },
      {
        state: config.ntdFields?.state ?? NTD_DEFAULTS.fields.state,
        reportYear: config.ntdFields?.reportYear ?? NTD_DEFAULTS.fields.reportYear,
        uzaName: config.ntdFields?.uzaName ?? NTD_DEFAULTS.fields.uzaName,
      },
      (info) => {
        sender.onProgress({
          isLoading: true,
          currentStage: 'fetching',
          message: `Fetching NTD data... ${info.fetchedCount} fetched, ${info.filteredCount} matched`,
          fetchedCount: info.fetchedCount,
          filteredCount: info.filteredCount,
        })
      }
    )

    // Process records
    sender.onProgress({
      isLoading: true,
      currentStage: 'processing',
      message: 'Processing records...',
      filteredCount: filteredValues.length,
    })

    const records = processNTDValues(filteredValues, config)
    const report = generateVisionEvalReport(records, config)

    // Send complete with report
    sender.onProgress({
      isLoading: false,
      currentStage: 'complete',
      message: 'Analysis complete!',
      report,
    })

    await writer.close()
    return report
  } catch (error) {
    sender.onError(error)
    await writer.close()
    throw error
  }
}

/**
 * Main analysis function - runs the VisionEval NTD analysis
 * This is the client-side compatible version (legacy, still works but less efficient)
 * @deprecated Use runVisionEvalAnalysisStreaming via the BFF endpoint for better performance
 */
export async function runVisionEvalAnalysis (
  config: VisionEvalConfig,
  client: GraphQLClient,
  onProgress?: (message: string, count?: number) => void
): Promise<VisionEvalReport> {
  const dataset = config.ntdDataset ?? NTD_DEFAULTS.dataset
  const table = config.ntdTable ?? NTD_DEFAULTS.table

  // Fetch NTD data with server-side filtering (works the same from client, just less efficient)
  onProgress?.('Fetching NTD metrics data...', 0)

  const filteredValues = await fetchNTDData(
    client,
    { dataset, table },
    {
      state: config.state,
      year: config.year,
      excludeNonUZA: true,
    },
    {
      state: config.ntdFields?.state ?? NTD_DEFAULTS.fields.state,
      reportYear: config.ntdFields?.reportYear ?? NTD_DEFAULTS.fields.reportYear,
      uzaName: config.ntdFields?.uzaName ?? NTD_DEFAULTS.fields.uzaName,
    },
    (info) => {
      onProgress?.(`Fetching NTD data... ${info.fetchedCount} fetched, ${info.filteredCount} matched`, info.filteredCount)
    }
  )

  // Process and filter records
  onProgress?.('Processing records...', filteredValues.length)
  const records = processNTDValues(filteredValues, config)

  // Generate output tables
  onProgress?.('Generating marea_transit_service table...', records.length)
  const report = generateVisionEvalReport(records, config)

  onProgress?.('Analysis complete!', records.length)

  return report
}

// Export mode mappings for UI use
export { NTD_TO_VISIONEVAL_MODE, VISIONEVAL_MODE_NAMES }
