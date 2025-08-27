/**
 * Simple CLI example showing how to use WSDOT Stops and Routes Report
 */
import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  type ScenarioCliOptions
} from './scenario-cli-util'
import { runScenarioData } from './scenario-cli'
import { WSDOTStopsRoutesReportFetcher, type WSDOTStopsRoutesReportConfig } from '~/src/reports/wsdot-stops-routes'
import { BasicGraphQLClient } from '~/src/graphql'
import { parseBbox } from '~/src/geom'
import { parseDate } from '~/src/datetime'

/**
 * Configure WSDOT Stops and Routes CLI command
 */
export function configureWsdotStopsRoutesReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--save-report <file>', 'Path to save WSDOT stops and routes report')
    .option('--save-stops-geojson <file>', 'Path to save stops as GeoJSON')
    .option('--save-routes-geojson <file>', 'Path to save routes as GeoJSON')
    .option('--no-schedule', 'Disable schedule fetching (default for this analysis)')
    .allowUnknownOption(false)
    .action(async (options) => {
      await runWsdotStopsRoutesReportCli(options as WSDOTStopsRoutesReportOptions)
    })
}

interface WSDOTStopsRoutesReportOptions extends ScenarioCliOptions {
  saveReport?: string
  saveStopsGeojson?: string
  saveRoutesGeojson?: string
}

/**
 * Execute scenario CLI with given options
 */
async function runWsdotStopsRoutesReportCli (options: WSDOTStopsRoutesReportOptions) {
  scenarioOptionsCheck(options)

  // Parse configuration from CLI options
  const config: WSDOTStopsRoutesReportConfig = {
    bbox: options.bbox ? parseBbox(options.bbox) : undefined,
    scheduleEnabled: false, // WSDOT stops/routes analysis doesn't need schedule data
    startDate: parseDate(options.startDate)!,
    endDate: parseDate(options.endDate)!,
    geographyIds: []
  }

  // Check for required environment variables
  const apiEndpoint = process.env.TRANSITLAND_API_ENDPOINT
  const apiKey = process.env.TRANSITLAND_API_KEY

  if (!apiEndpoint) {
    console.error('❌ Error: TRANSITLAND_API_ENDPOINT environment variable is required')
    console.error('   Please set it to your TransitLand GraphQL API endpoint')
    console.error('   Example: export TRANSITLAND_API_ENDPOINT="https://api.transit.land/v2/graphql"')
    process.exit(1)
  }

  if (!apiKey) {
    console.error('❌ Error: TRANSITLAND_API_KEY environment variable is required')
    console.error('   Please set it to your TransitLand API key')
    console.error('   Example: export TRANSITLAND_API_KEY="your_api_key_here"')
    process.exit(1)
  }

  // Create GraphQL client
  const client = new BasicGraphQLClient(apiEndpoint, apiKey)

  console.log('🚀 Starting WSDOT Stops and Routes Analysis...')
  console.log(`📍 Bounding Box: ${options.bbox}`)
  console.log(`📅 Date Range: ${options.startDate} to ${options.endDate}`)
  console.log(`⏰ Schedule Enabled: ${config.scheduleEnabled} (not needed for this analysis)`)

  const result = await runScenarioData(options)

  // Process WSDOT Stops and Routes Report
  console.log('\n🔍 Processing stops and routes data...')
  const wsdotFetcher = new WSDOTStopsRoutesReportFetcher(config, result, client)
  const report = await wsdotFetcher.fetch()

  // Display summary
  console.log('\n📊 WSDOT Stops and Routes Report Summary:')
  console.log(`🚏 Total Stops: ${report.stops.length}`)
  console.log(`🚌 Total Routes: ${report.routes.length}`)
  console.log(`🏢 Total Agencies: ${report.agencies.length}`)

  // Display agency breakdown
  console.log('\n🏢 Agency Breakdown:')
  for (const agency of report.agencies) {
    console.log(`  - ${agency.agencyName}: ${agency.stopsCount} stops, ${agency.routesCount} routes`)
  }

  // Save report if requested
  if (options.saveReport) {
    const fs = await import('fs/promises')
    await fs.writeFile(options.saveReport, JSON.stringify(report, null, 2))
    console.log(`💾 Report saved to: ${options.saveReport}`)
  }

  // Save stops GeoJSON if requested
  if (options.saveStopsGeojson) {
    const stopsGeoJSON = {
      type: 'FeatureCollection',
      features: report.stops.map(stop => ({
        type: 'Feature',
        properties: {
          stopId: stop.stopId,
          stopName: stop.stopName,
          agencyId: stop.agencyId,
          feedOnestopId: stop.feedOnestopId
        },
        geometry: stop.geometry
      }))
    }
    const fs = await import('fs/promises')
    await fs.writeFile(options.saveStopsGeojson, JSON.stringify(stopsGeoJSON, null, 2))
    console.log(`💾 Stops GeoJSON saved to: ${options.saveStopsGeojson}`)
  }

  // Save routes GeoJSON if requested
  if (options.saveRoutesGeojson) {
    const routesGeoJSON = {
      type: 'FeatureCollection',
      features: report.routes.map(route => ({
        type: 'Feature',
        properties: {
          routeId: route.routeId,
          routeShortName: route.routeShortName,
          routeLongName: route.routeLongName,
          routeType: route.routeType,
          agencyId: route.agencyId,
          feedOnestopId: route.feedOnestopId
        },
        geometry: route.geometry
      }))
    }
    const fs = await import('fs/promises')
    await fs.writeFile(options.saveRoutesGeojson, JSON.stringify(routesGeoJSON, null, 2))
    console.log(`💾 Routes GeoJSON saved to: ${options.saveRoutesGeojson}`)
  }

  console.log('\n✅ WSDOT Stops and Routes Report generated successfully!')
}
