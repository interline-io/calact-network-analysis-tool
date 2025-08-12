/**
 * Simple CLI example showing how to use ScenarioFetcher
 */

import type { Command } from 'commander'
import { ScenarioFetcher, type ScenarioConfig, type ScenarioData, type ScenarioFilter } from '~/src/scenario'
import { parseBbox } from '~/src/geom'
import { cannedBboxes } from '~/src/constants'
import { BasicGraphQLClient } from '~/src/graphql'
import { saveScenarioTestFixtureToFile } from '~/src/scenario-fixtures'

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate (): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * Get date one week from now in YYYY-MM-DD format
 */
function getDateOneWeekLater (): string {
  const date = new Date()
  date.setDate(date.getDate() + 7)
  return date.toISOString().split('T')[0]
}

/**
 * Configure scenario CLI command
 */
export function configureScenarioCli (program: Command) {
  program
    .option('--bbox <bbox>', 'Bounding box in format "min_lon,min_lat,max_lon,max_lat"', cannedBboxes.get('Downtown Portland, OR'))
    .option('--start-date <date>', 'Start date (YYYY-MM-DD)', getCurrentDate())
    .option('--end-date <date>', 'End date (YYYY-MM-DD)', getDateOneWeekLater())
    .option('--start-time <time>', 'Start time (HH:MM)', '06:00')
    .option('--end-time <time>', 'End time (HH:MM)', '22:00')
    .option('--endpoint <url>', 'GraphQL API URL', 'https://api.transit.land/api/v2/query')
    .option('--output <format>', 'Output format (json|csv|summary)', 'summary')
    .option('--save <filename>', 'Save scenario data and config to file')
    .option('--schedule', 'Enable schedule fetching', true)
    .option('--no-schedule', 'Disable schedule fetching')
    .allowUnknownOption(false)
    .action(async (options) => {
      await runScenarioCli(options as ScenarioCliOptions)
    })
}

/**
 * CLI options interface for scenario commands
 */
interface ScenarioCliOptions {
  bbox?: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  endpoint: string
  output: string
  save?: string
  schedule: boolean
}

/**
 * Execute scenario CLI with given options
 */
async function runScenarioCli (options: ScenarioCliOptions) {
  try {
    console.log('🚌 Starting transit scenario fetch...')

    // Parse configuration from CLI options
    const config: ScenarioConfig = {
      bbox: options.bbox ? parseBbox(options.bbox) : undefined,
      scheduleEnabled: options.schedule,
      startDate: new Date(options.startDate),
      endDate: new Date(options.endDate),
      geographyIds: []
    }
    // const filter: ScenarioFilter = {
    //   startTime: parseTime(options.startTime),
    //   endTime: parseTime(options.endTime),
    //   selectedRouteTypes: options.routeTypes.split(',').map(Number),
    //   selectedDays: options.days.split(',') as any[],
    //   selectedAgencies: options.agencies ? options.agencies.split(',') : [],
    //   selectedDayOfWeekMode: 'Any',
    //   selectedTimeOfDayMode: 'All',
    //   frequencyUnderEnabled: false,
    //   frequencyOverEnabled: false,
    // }

    // Validate configuration
    if (!config.bbox?.valid && !config.geographyIds?.length) {
      console.error('❌ Error: Must provide --bbox')
      process.exit(1)
    }

    // Create GraphQL client
    const client = new BasicGraphQLClient(
      options.endpoint,
      process.env.TRANSITLAND_API_KEY || ''
    )

    // Create scenario fetcher with progress reporting
    const fetcher = new ScenarioFetcher(config, client, {
      onProgress: (progress) => {
        if (progress.isLoading) {
          const { completed, total } = progress.stopDepartureProgress
          if (total > 0) {
            process.stdout.write(`\r⏳ Loading... (${completed}/${total} completed)`)
          } else {
            process.stdout.write('\r⏳ Loading...')
          }
        }
      },
      onError: (error) => {
        console.error('\n❌ Error during fetch:', error.message)
      }
    })

    // Execute the fetch
    const startTime = Date.now()
    const result = await fetcher.fetch()
    const duration = Date.now() - startTime

    console.log('\n✅ Fetch completed!')
    console.log(`⏱️  Duration: ${duration}ms`)

    // Save scenario data if requested
    if (options.save) {
      await saveScenarioData(options.save, result, config)
    }

    // Output results based on format
    switch (options.output) {
      case 'json':
        console.log(JSON.stringify(result, null, 2))
        break

      case 'csv':
        outputCSV(result)
        break

      case 'summary':
      default:
        outputSummary(result)
        break
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    process.exit(1)
  }
}

/**
 * Output summary of results
 */
function outputSummary (result: ScenarioData) {
  console.log('\n📊 Results Summary:')
  console.log(`🚏 Total Stops: ${result.stops.length}`)
  console.log(`🚌 Total Routes: ${result.routes.length}`)
  // console.log(`🏢 Total Agencies: ${result.agencies.length}`)

  const markedStops = result.stops.filter((s: any) => s.marked)
  const markedRoutes = result.routes.filter((r: any) => r.marked)
  // const markedAgencies = result.agencies.filter((a: any) => a.marked)

  console.log(`✅ Filtered Stops: ${markedStops.length}`)
  console.log(`✅ Filtered Routes: ${markedRoutes.length}`)
  // console.log(`✅ Filtered Agencies: ${markedAgencies.length}`)

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
function outputCSV (result: any) {
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
 * Save scenario data and config to a file
 */
async function saveScenarioData (filename: string, data: ScenarioData, config: ScenarioConfig) {
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

  await saveScenarioTestFixtureToFile(fixture, filename)
  console.log(`💾 Scenario data saved to: ${filename}`)
}
