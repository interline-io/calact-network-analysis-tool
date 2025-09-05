/**
 * Simple CLI example showing how to use WSDOT Stops and Routes Report
 */
import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck, runScenarioData
} from './scenario-cli'
import type { WSDOTReportOptions } from './wsdot-cli'
import { WSDOTReportFetcher } from '~/src/reports/wsdot'
import { processWsdotReport, type WSDOTStopsRoutesReportConfig } from '~/src/reports/wsdot-stops-routes'
import { apiFetch, BasicGraphQLClient } from '~/src/graphql'
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
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .allowUnknownOption(false)
    .action(async (options) => {
      await runWsdotStopsRoutesReportCli(options as WSDOTStopsRoutesReportOptions)
    })
}

export interface WSDOTStopsRoutesReportOptions extends WSDOTReportOptions {
  saveReport?: string
  saveStopsGeojson?: string
  saveRoutesGeojson?: string
}

/**
 * Execute scenario CLI with given options
 */
export async function runWsdotStopsRoutesReportCli (options: WSDOTStopsRoutesReportOptions) {
  scenarioOptionsCheck(options)

  // Parse configuration from CLI options
  const config: WSDOTStopsRoutesReportConfig = {
    bbox: options.bbox ? parseBbox(options.bbox) : undefined,
    scheduleEnabled: !options.noSchedule,
    startDate: parseDate(options.startDate)!,
    endDate: parseDate(options.endDate)!,
    weekdayDate: parseDate(options.weekdayDate)!,
    weekendDate: parseDate(options.weekendDate)!,
    geographyIds: []
  }

  // Create GraphQL client
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || '')
  )

  // Process main scenario
  console.log('🚀 Starting WSDOT Stops and Routes Analysis...')
  console.log(`📍 Bounding Box: ${options.bbox}`)
  console.log(`📅 Date Range: ${options.startDate} to ${options.endDate}`)
  const scenarioData = await runScenarioData(options)

  // Process WSDOT Stops and Routes Report
  console.log('\n🔍 Processing stops and routes data...')
  const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)
  const wsdotReport = await wsdotFetcher.fetch()

  const report = processWsdotReport(scenarioData, wsdotReport)

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
