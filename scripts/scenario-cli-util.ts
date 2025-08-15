import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import type { Readable } from 'stream'
import type { Command } from 'commander'
import bigJson from 'big-json'
import { cannedBboxes } from '~/src/constants'
import { getCurrentDate, getDateOneWeekLater } from '~/src/datetime'
import type { ScenarioData, ScenarioConfig, ScenarioFilter } from '~/src/scenario'
import { serializeScenarioTestFixture } from '~/src/scenario-fixtures'

/**
 * Stream a JSON object to disk in chunks to handle large files efficiently
 */

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
    .option('--endpoint <url>', 'GraphQL API URL', 'https://api.transit.land/api/v2/query')
    .option('--output <format>', 'Output format (json|csv|summary)', 'summary')
    .option('--save-scenario-data <filename>', 'Save scenario data and config to file')
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
  endpoint: string
  output: string
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
 * Save scenario data and config to a file using streaming JSON
 */
export async function scenarioSaveData (filename: string, data: ScenarioData, config: ScenarioConfig) {
  // Create a default ScenarioFilter with sensible defaults
  const filter: ScenarioFilter = {
    selectedRouteTypes: [],
    selectedDays: [],
    selectedAgencies: [],
    selectedDayOfWeekMode: 'Any',
    selectedTimeOfDayMode: 'All',
    frequencyUnderEnabled: false,
    frequencyOverEnabled: false
  }
  const fixture = {
    config,
    filter,
    data
  }
  const fixtureData = serializeScenarioTestFixture(fixture)

  // Use the general streaming helper
  console.log('Start writing file....')
  await streamJsonToFile(filename, fixtureData)
  console.log('...done')
  console.log(`💾 Scenario data saved to: ${filename}`)
}

export async function streamJsonToFile (
  filename: string,
  data: any,
): Promise<void> {
  const writeStream = createWriteStream(filename)
  const stringifyStream = bigJson.createStringifyStream({
    body: data
  }) as Readable // Type assertion to tell TypeScript this is a Readable stream
  await pipeline(stringifyStream, writeStream)
}
