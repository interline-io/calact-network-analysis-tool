/**
 * Simple CLI example showing how to use WSDOT Report
 */

import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  type ScenarioCliOptions
} from './util'
import { runScenarioData } from './scenario'
import { wsdotReport, wsdotReportSave } from '~/src/reports/wsdot'

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
}

/**
 * Execute scenario CLI with given options
 */
async function runWsdotReportScli (options: WSDOTReportOptions) {
  scenarioOptionsCheck(options)
  const result = await runScenarioData(options)
  console.log('result?', result)

  // Process WSDOT Report
  const report = wsdotReport(result, options.weekdayDate, options.weekendDate)
  console.log('✅ WSDOT Report generated!')

  // Save WSDOT report
  if (options.saveWsdotReport) {
    wsdotReportSave(report, options.saveWsdotReport)
  }
}
