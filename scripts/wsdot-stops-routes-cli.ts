/**
 * Simple CLI example showing how to use WSDOT Stops and Routes Report
 */
import type { Command } from 'commander'
import {
  createStreamController,
  scenarioOptionsAdd,
  scenarioOptionsCheck,
} from './scenario-cli'
import type { WSDOTReportOptions } from './wsdot-cli'
import { runAnalysis } from '~/src/analysis/wsdot-stops-routes'
import type { WSDOTReportConfig } from '~/src/analysis/wsdot'
import { apiFetch, BasicGraphQLClient, parseBbox, parseDate, DEFAULT_CENSUS_DATASET, DEFAULT_GEODATA_DATASET } from '~/src/core'

export interface WSDOTStopsRoutesReportOptions extends WSDOTReportOptions {
  saveReport?: string
  saveStopsGeojson?: string
  saveRoutesGeojson?: string
}

export function configureWsdotStopsRoutesReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--save-report <file>', 'Path to save WSDOT stops and routes report')
    .option('--save-stops-geojson <file>', 'Path to save stops as GeoJSON')
    .option('--save-routes-geojson <file>', 'Path to save routes as GeoJSON')
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .allowUnknownOption(false)
    .action(async (_options) => {
      const opts = _options as WSDOTStopsRoutesReportOptions
      scenarioOptionsCheck(opts)

      // Parse configuration from CLI options
      const config: WSDOTReportConfig = {
        reportName: 'WSDOT Stops and Routes Report',
        bbox: opts.bbox ? parseBbox(opts.bbox) : undefined,
        scheduleEnabled: opts.schedule ?? true,
        startDate: parseDate(opts.startDate)!,
        endDate: parseDate(opts.endDate)!,
        weekdayDate: parseDate(opts.weekdayDate)!,
        weekendDate: parseDate(opts.weekendDate)!,
        routeHourCompatMode: true,
        stopBufferRadius: 800,
        tableDatasetName: DEFAULT_CENSUS_DATASET,
        tableDatasetTable: 'b01001',
        tableDatasetTableCol: 'b01001_001',
        geoDatasetName: DEFAULT_GEODATA_DATASET,
        geoDatasetLayer: 'tract',
        aggregateLayer: 'state',
      }

      const client = new BasicGraphQLClient(
        (process.env.TRANSITLAND_API_BASE || '') + '/query',
        apiFetch(process.env.TRANSITLAND_API_KEY || ''),
      )

      // Create a controller that optionally saves to file
      const controller = createStreamController(opts.saveScenarioData)
      const { stopsRoutesReport } = await runAnalysis(controller, config, client)

      // // Save stops GeoJSON if requested
      if (opts.saveStopsGeojson) {
        const stopsGeoJSON = {
          type: 'FeatureCollection',
          features: stopsRoutesReport.stops.map(stop => ({
            type: 'Feature',
            properties: {
              stopId: stop.stopId,
              stopName: stop.stopName,
              agencyId: stop.agencyId,
              feedOnestopId: stop.feedOnestopId,
            },
            geometry: stop.geometry,
          })),
        }
        const fs = await import('node:fs/promises')
        await fs.writeFile(opts.saveStopsGeojson, JSON.stringify(stopsGeoJSON, null, 2))
        console.log(`💾 Stops GeoJSON saved to: ${opts.saveStopsGeojson}`)
      }

      // // Save routes GeoJSON if requested
      if (opts.saveRoutesGeojson) {
        const routesGeoJSON = {
          type: 'FeatureCollection',
          features: stopsRoutesReport.routes.map(route => ({
            type: 'Feature',
            properties: {
              routeId: route.routeId,
              routeShortName: route.routeShortName,
              routeLongName: route.routeLongName,
              routeType: route.routeType,
              agencyId: route.agencyId,
              feedOnestopId: route.feedOnestopId,
            },
            geometry: route.geometry,
          })),
        }
        const fs = await import('node:fs/promises')
        await fs.writeFile(opts.saveRoutesGeojson, JSON.stringify(routesGeoJSON, null, 2))
        console.log(`💾 Routes GeoJSON saved to: ${opts.saveRoutesGeojson}`)
      }
      console.log('\n✅ WSDOT Stops and Routes Report generated successfully!')
    })
}
