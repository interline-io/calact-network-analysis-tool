/**
 * Simple CLI example showing how to use ScenarioFetcher
 */

import type { Command } from 'commander'
import { cannedBboxes } from '~/src/constants'
import { getCurrentDate, getDateOneWeekLater, parseDate } from '~/src/datetime'

// Core scenario functionality
import type { ScenarioData, ScenarioConfig } from '~/src/scenario'
import { ScenarioDataReceiver, ScenarioFetcher, ScenarioStreamReceiver, ScenarioStreamSender } from '~/src/scenario'

// Utilities
import { parseBbox } from '~/src/geom'
import { BasicGraphQLClient, apiFetch } from '~/src/graphql'
import { multiplexStream, requestStream } from '~/src/stream'

/**
 * Add common scenario configuration options to a Commander.js program
 */
export function scenarioOptionsAdd (program: Command): Command {
  return program
    .option('--bbox <bbox>', 'Bounding box in format "min_lon,min_lat,max_lon,max_lat"')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD)', getCurrentDate())
    .option('--end-date <date>', 'End date (YYYY-MM-DD)', getDateOneWeekLater())
    .option('--start-time <time>', 'Start time (HH:MM)', '06:00')
    .option('--end-time <time>', 'End time (HH:MM)', '22:00')
    .option('--output <format>', 'Output format (json|csv|summary)', 'summary')
    .option('--save-scenario-data <filename>', 'Save scenario data and config to file')
    .option('--aggregate-layer <layer>', 'Census geography layer for aggregation (e.g., tract, blockgroup)', 'tract')
    .option('--bbox-name <name>', 'Use canned bounding box', 'portland')
    .option('--no-schedule', 'Disable schedule fetching')
}

export function scenarioOptionsCheck (options: ScenarioCliOptions) {
  if (options.bboxName) {
    options.bbox = cannedBboxes.get(options.bboxName)?.bboxString
  }
  if (!options.bbox) {
    console.error('❌ Error: Must provide --bbox')
    process.exit(1)
  }

  // Check for required environment variables
  try {
    checkTransitlandEnv()
  } catch {
    console.error('❌ Error: missing required environment variables')
    process.exit(1)
  }
}

/**
 * CLI options interface for scenario commands
 */
export interface ScenarioCliOptions {
  bbox?: string
  bboxName: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  output: string
  aggregateLayer: string
  saveScenarioData?: string
  noSchedule: boolean
}

/**
 * Output summary of results
 */
export function scenarioOutputSummary (result: ScenarioData) {
  console.log('\n📊 Results Summary:')
  console.log(`🚏 Total Stops: ${result.stops.length}`)
  console.log(`🚌 Total Routes: ${result.routes.length}`)

  const markedStops = result.stops.filter((s: any) => s.marked)
  const markedRoutes = result.routes.filter((r: any) => r.marked)

  console.log(`✅ Filtered Stops: ${markedStops.length}`)
  console.log(`✅ Filtered Routes: ${markedRoutes.length}`)

  if (markedRoutes.length > 0) {
    console.log('\n🚌 Sample Routes:')
    markedRoutes.slice(0, 5).forEach((route: any) => {
      console.log(`  - ${route.route_name} (${route.route_mode}) - ${route.agency_name}`)
    })
  }
}

/**
 * Output CSV format (simplified)
 */
export function scenarioOutputCsv (result: any) {
  console.log('\n📄 Routes CSV:')
  console.log('id,route_name,route_mode,agency_name,marked')
  result.routes.forEach((route: any) => {
    console.log(`${route.id},"${route.route_name}","${route.route_mode}","${route.agency_name}",${route.marked}`)
  })

  console.log('\n📄 Stops CSV:')
  console.log('id,stop_name,marked,routes_count')
  result.stops.forEach((stop: any) => {
    const routeCount = stop.route_stops?.length || 0
    console.log(`${stop.id},"${stop.stop_name || 'Unnamed'}",${stop.marked},${routeCount}`)
  })
}

/**
 * Check environemnt config
 */
export function checkTransitlandEnv () {
  const apiEndpoint = process.env.TRANSITLAND_API_BASE
  const apiKey = process.env.TRANSITLAND_API_KEY

  if (!apiEndpoint) {
    console.error('❌ Error: TRANSITLAND_API_BASE environment variable is required')
    console.error('   Please set it to your TransitLand GraphQL API endpoint')
    console.error('   Example: export TRANSITLAND_API_BASE="https://api.transit.land/api/v2"')
    throw new Error('Missing TRANSITLAND_API_BASE environment variable')
  }

  if (!apiKey) {
    console.error('❌ Error: TRANSITLAND_API_KEY environment variable is required')
    console.error('   Please set it to your TransitLand API key')
    console.error('   Example: export TRANSITLAND_API_KEY="your_api_key_here"')
    throw new Error('Missing TRANSITLAND_API_KEY environment variable')
  }
}

/**
 * Configure scenario CLI command
 */
export function configureScenarioCli (program: Command) {
  scenarioOptionsAdd(program)
    .allowUnknownOption(false)
    .action(async (options) => {
      await runScenarioCli(options as ScenarioCliOptions)
    })
}

/**
 * Execute scenario CLI with given options
 */
async function runScenarioCli (options: ScenarioCliOptions) {
  scenarioOptionsCheck(options)
  await runScenarioData(options)
}

export async function runScenarioData (options: ScenarioCliOptions): Promise<ScenarioData> {
  console.log('🚌 Starting transit scenario fetch...')

  // Parse configuration from CLI options
  const config: ScenarioConfig = {
    bbox: options.bbox ? parseBbox(options.bbox) : undefined,
    scheduleEnabled: !options.noSchedule,
    startDate: parseDate(options.startDate)!,
    endDate: parseDate(options.endDate)!,
    aggregateLayer: options.aggregateLayer,
    geographyIds: []
  }

  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || '')
  )

  // Create a transform stream that optionally multiplexes to file
  const fileStream = await import('fs').then(fs => fs.createWriteStream('test.json'))
  console.log(`📝 Logging scenario data to: ${options.saveScenarioData}`)

  const { inputStream, outputStream } = multiplexStream(fileStream)
  const writer = inputStream.getWriter()

  // Create writable stream writer that writes to the response

  // Configure fetcher/sender
  const scenarioDataSender = new ScenarioStreamSender(writer)
  const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

  // Configure client/receiver
  const receiver = new ScenarioDataReceiver()
  const scenarioDataClient = new ScenarioStreamReceiver()

  // Await data - start both concurrently and wait for both to complete
  await Promise.all([
    scenarioDataClient.processStream(outputStream, receiver),
    fetcher.fetch()
  ])

  const result = receiver.getCurrentData()
  console.log('✅ Fetch completed!')

  // Output results based on format
  switch (options.output) {
    case 'json':
      console.log(JSON.stringify(result, null, '  '))
      break

    case 'csv':
      scenarioOutputCsv(result)
      break

    case 'summary':
    default:
      scenarioOutputSummary(result)
      break
  }

  return result
}
