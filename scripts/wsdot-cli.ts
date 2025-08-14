/**
 * Simple CLI example showing how to use WSDOT Report
 */
import { promises as fs } from 'fs'
import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  type ScenarioCliOptions
} from './scenario-cli-util'
import { runScenarioData } from './scenario-cli'
import { WSDOTReportFetcher, wsdotReportSave, type WSDOTReportConfig, levelColors } from '~/src/reports/wsdot'
import { BasicGraphQLClient } from '~/src/graphql'
import { parseBbox } from '~/src/geom'
import { parseDate } from '~/src/datetime'
/**
 * Configure WSDOT CLI command
 */
export function configureWsdotReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--save-wsdot-report <file>', 'Path to save WSDOT report')
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .allowUnknownOption(false)
    .action(async (options) => {
      await runWsdotReportScli(options as WSDOTReportOptions)
    })
}

interface WSDOTReportOptions extends ScenarioCliOptions {
  saveWsdotReport: string
  weekdayDate: string
  weekendDate: string
  scheduleEnabled: boolean
}

/**
 * Execute scenario CLI with given options
 */
async function runWsdotReportScli (options: WSDOTReportOptions) {
  scenarioOptionsCheck(options)

  // Parse configuration from CLI options
  const config: WSDOTReportConfig = {
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
    options.endpoint,
    process.env.TRANSITLAND_API_KEY || ''
  )

  const result = await runScenarioData(options)

  // Process WSDOT Report
  const wsdotFetcher = new WSDOTReportFetcher(config, result, client)
  const report = await wsdotFetcher.fetch()
  console.log('✅ WSDOT Report generated!')

  // Save WSDOT report
  if (options.saveWsdotReport) {
    wsdotReportSave(report, options.saveWsdotReport)
    for (const [level, levelLayer] of Object.entries(report.levelLayers)) {
      const levelColor = levelColors[level] || '#000000'
      console.log(`Level Layer: ${level} color: ${levelColor}`)
      for (const feature of levelLayer) {
        feature.properties['stroke'] = levelColor
        feature.properties['fill'] = levelColor
      }
      const layerFc = { type: 'FeatureCollection', features: levelLayer }
      const fn = `${options.saveWsdotReport.split('.')[0]}_${level}.geojson`
      await fs.writeFile(fn, JSON.stringify(layerFc))
    }
  }
}
