/**
 * Simple CLI example showing how to use WSDOT Report
 */
import type { Command } from 'commander'
import {
  runScenarioData,
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  type ScenarioCliOptions
} from './scenario-cli'
import { WSDOTReportFetcher, type WSDOTReportConfig } from '~/src/reports/wsdot'
import { apiFetch, BasicGraphQLClient } from '~/src/graphql'
import { parseBbox } from '~/src/geom'
import { parseDate } from '~/src/datetime'

/**
 * Configure WSDOT CLI command
 */
export function configureWsdotReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .allowUnknownOption(false)
    .action(async (options) => {
      await runWsdotReportScli(options as WSDOTReportOptions)
    })
}

export interface WSDOTReportOptions extends ScenarioCliOptions {
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
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || '')
  )

  // Process main scenario
  const result = await runScenarioData(options)

  // Process WSDOT Report
  const wsdotFetcher = new WSDOTReportFetcher(config, result, client)
  await wsdotFetcher.fetch()
  console.log('✅ WSDOT Report generated!')
}
