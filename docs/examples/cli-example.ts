#!/usr/bin/env node

/**
 * Simple CLI example showing how to use ScenarioFetcher
 *
 * Usage:
 *   npm run cli-example -- --bbox "-122.8,45.4,-122.5,45.7" --start-date "2024-07-03" --end-date "2024-07-10"
 */

import { Command } from 'commander'
import { print } from 'graphql'
import { ScenarioFetcher, type GraphQLClient, type ScenarioConfig, type ScenarioData, type ScenarioFilter } from '~/src/scenario'
import { parseBbox } from '~/src/geom'
import { cannedBboxes } from '~/src/constants'

/**
 * Simple GraphQL client using fetch
 */
class FetchGraphQLClient implements GraphQLClient {
  private baseUrl: string
  private apiKey?: string

  constructor (baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    // Extract query string from DocumentNode or use as-is if string
    let queryString: string
    if (typeof query === 'string') {
      queryString = query
    } else {
      // Use graphql print function to convert DocumentNode to string
      queryString = print(query)
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    }

    // Add API key if provided
    if (this.apiKey) {
      headers['apikey'] = this.apiKey
    }

    const requestBody = {
      query: queryString,
      variables,
    }

    // Debug logging (reduced)
    console.log('🔍 Making GraphQL request to:', this.baseUrl)
    console.log('📦 Variables:', JSON.stringify(variables, null, 2))

    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })

      const responseText = await response.text()
      console.log('✅ Response Status:', response.status, response.statusText)

      if (!response.ok) {
        console.log('❌ Response Body:', responseText.substring(0, 300) + (responseText.length > 300 ? '...' : ''))
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = JSON.parse(responseText)

      if (result.errors) {
        throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`)
      }

      return result
    } catch (error) {
      console.error('GraphQL request failed:', error)
      throw error
    }
  }
}

/**
 * Main CLI function
 */
async function main () {
  const program = new Command()

  program
    .name('scenario-cli')
    .description('Fetch transit scenario data via CLI')
    .version('1.0.0')
    .option('-b, --bbox <bbox>', 'Bounding box in format "min_lon,min_lat,max_lon,max_lat"', cannedBboxes.get('Downtown Portland, OR'))
    .option('-s, --start-date <date>', 'Start date (YYYY-MM-DD)', '2024-07-03')
    .option('-e, --end-date <date>', 'End date (YYYY-MM-DD)', '2024-07-10')
    .option('-st, --start-time <time>', 'Start time (HH:MM)', '06:00')
    .option('-et, --end-time <time>', 'End time (HH:MM)', '22:00')
    .option('-rt, --route-types <types>', 'Route types (comma-separated)', '3')
    .option('-d, --days <days>', 'Days of week (comma-separated)', 'monday,tuesday,wednesday,thursday,friday')
    .option('-a, --agencies <agencies>', 'Agency names (comma-separated)', '')
    .option('--api-url <url>', 'GraphQL API URL', 'https://api.transit.land/api/v2/query')
    .option('--api-key <key>', 'API key for authentication (or set TRANSITLAND_API_KEY env var)')
    .option('--output <format>', 'Output format (json|csv|summary)', 'summary')
    .option('--schedule', 'Enable schedule fetching', true)
    .option('--no-schedule', 'Disable schedule fetching')

  program.parse(process.argv)

  const options = program.opts()

  try {
    console.log('🚌 Starting transit scenario fetch...')
    console.log('Options:', options)

    // Parse configuration from CLI options
    const config: ScenarioConfig = {
      bbox: options.bbox ? parseBbox(options.bbox) : undefined,
      scheduleEnabled: options.schedule,
      startDate: new Date(options.startDate),
      endDate: new Date(options.endDate),
      geographyIds: []
    }
    const filter: ScenarioFilter = {
      startTime: parseTime(options.startTime),
      endTime: parseTime(options.endTime),
      selectedRouteTypes: options.routeTypes.split(',').map(Number),
      selectedDays: options.days.split(',') as any[],
      selectedAgencies: options.agencies ? options.agencies.split(',') : [],
      selectedDayOfWeekMode: 'Any',
      selectedTimeOfDayMode: 'All',
      frequencyUnderEnabled: false,
      frequencyOverEnabled: false,
    }
    console.log('filter:', filter)

    // Validate configuration
    if (!config.bbox?.valid && !config.geographyIds?.length) {
      console.error('❌ Error: Must provide either --bbox or --geography-ids')
      process.exit(1)
    }

    // Create GraphQL client
    const apiKey = options.apiKey || process.env.TRANSITLAND_API_KEY
    if (!apiKey) {
      console.warn('⚠️  Warning: No API key provided. Some requests may fail with 401 Unauthorized.')
      console.warn('   Set TRANSITLAND_API_KEY environment variable or use --api-key option.')
      console.warn('   Get your API key from https://www.transit.land/')
    }
    const client = new FetchGraphQLClient(options.apiUrl, apiKey)

    // Create scenario fetcher with progress reporting
    const fetcher = new ScenarioFetcher(config, client, {
      onProgress: (progress) => {
        if (progress.isLoading) {
          const { queue } = progress.stopDepartureProgress
          if (queue > 0) {
            process.stdout.write(`\r⏳ Loading... (${queue} queries remaining)`)
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
 * Parse time string HH:MM to Date object
 */
function parseTime (timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
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

  // if (markedAgencies.length > 0) {
  //   console.log('\n🏢 Agencies:')
  //   markedAgencies.forEach((agency: any) => {
  //     console.log(`  - ${agency.agency_name}: ${agency.routes_count} routes, ${agency.stops_count} stops`)
  //   })
  // }
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

// Run the CLI if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error)
}

export { main }
