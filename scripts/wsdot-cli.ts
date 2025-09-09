/**
 * Simple CLI example showing how to use WSDOT Report
 */
import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  type ScenarioCliOptions
} from './scenario-cli'
import { createStreamController } from './calact-utils'
import { runWSDOTReportFetcher, type WSDOTReportConfig } from '~/src/reports/wsdot'
import { apiFetch, BasicGraphQLClient, parseBbox, parseDate } from '~/src/core'

export interface WSDOTReportOptions extends ScenarioCliOptions {
  weekdayDate: string
  weekendDate: string
  scheduleEnabled: boolean
}

export function configureWsdotReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .allowUnknownOption(false)
    .action(async (options) => {
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

      const client = new BasicGraphQLClient(
        (process.env.TRANSITLAND_API_BASE || '') + '/query',
        apiFetch(process.env.TRANSITLAND_API_KEY || '')
      )

      // Create a controller that optionally saves to file
      const controller = createStreamController(options.saveScenarioData)
      const result = await runWSDOTReportFetcher(controller, config, client)
      return result
    })
}
