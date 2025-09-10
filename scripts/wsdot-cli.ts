/**
 * Simple CLI example showing how to use WSDOT Report
 */
import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  createStreamController,
  type ScenarioCliOptions,
} from './scenario-cli'
import { runAnalysis, type WSDOTReportConfig } from '~/src/analysis/wsdot'
import { apiFetch, BasicGraphQLClient, parseBbox, parseDate } from '~/src/core'

export interface WSDOTReportOptions extends ScenarioCliOptions {
  weekdayDate: string
  weekendDate: string
  stopBufferRadius: number
  scheduleEnabled: boolean
}

export function configureWsdotReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .option('--stop-buffer-radius <meters>', 'Buffer radius around stops in meters', parseFloat, 400)
    .allowUnknownOption(false)
    .action(async (_options) => {
      const opts = _options as WSDOTReportOptions
      scenarioOptionsCheck(opts)

      // Parse configuration from CLI options
      const config: WSDOTReportConfig = {
        bbox: opts.bbox ? parseBbox(opts.bbox) : undefined,
        scheduleEnabled: !!opts.schedule,
        startDate: parseDate(opts.startDate)!,
        endDate: parseDate(opts.endDate)!,
        weekdayDate: parseDate(opts.weekdayDate)!,
        weekendDate: parseDate(opts.weekendDate)!,
        stopBufferRadius: opts.stopBufferRadius,
        aggregateLayer: opts.aggregateLayer,
        geographyIds: []
      }

      const client = new BasicGraphQLClient(
        (process.env.TRANSITLAND_API_BASE || '') + '/query',
        apiFetch(process.env.TRANSITLAND_API_KEY || '')
      )

      // Create a controller that optionally saves to file
      const controller = createStreamController(opts.saveScenarioData)
      const result = await runAnalysis(controller, config, client)
      return result
    })
}
