/**
 * Simple CLI example showing how to use WSDOT Report
 */
import type { Command } from 'commander'
import { format, nextMonday, nextSunday } from 'date-fns'
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
  tableDatasetName: string
  tableDatasetTable: string
  tableDatasetTableCol: string
  geoDatasetName: string
  geoDatasetLayer: string
}

export function configureWsdotReportCli (program: Command) {
  scenarioOptionsAdd(program)
    .option('--weekday-date <date>', 'Date for weekday report (YYYY-MM-DD)')
    .option('--weekend-date <date>', 'Date for weekend report (YYYY-MM-DD)')
    .option('--table-dataset-name <name>', 'Name of the Census dataset to use', 'acsdt5y2022')
    .option('--table-dataset-table <table>', 'Name of the Census table to use', 'b01001')
    .option('--table-dataset-table-col <column>', 'Name of the Census table column to use', 'b01001_001')
    .option('--geo-dataset-name <name>', 'Name of the Census geographic dataset to use', 'tiger2024')
    .option('--geo-dataset-layer <layer>', 'Name of the Census geographic layer to use', 'tract')
    .option('--stop-buffer-radius <meters>', 'Buffer radius around stops in meters', parseFloat, 400)
    .allowUnknownOption(false)
    .action(async (_options) => {
      const opts = _options as WSDOTReportOptions
      scenarioOptionsCheck(opts)

      const today = new Date() // Or any starting date you desire
      const monday = nextMonday(today)
      if (!opts.weekdayDate) {
        opts.weekdayDate = format(monday, 'yyyy-MM-dd')
        console.log('using next monday as weekdayDate:', opts.weekdayDate)
      }
      if (!opts.weekendDate) {
        opts.weekendDate = format(nextSunday(monday), 'yyyy-MM-dd')
        console.log('using next sunday as weekendDate:', opts.weekendDate)
      }

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
        tableDatasetName: opts.tableDatasetName,
        tableDatasetTable: opts.tableDatasetTable,
        tableDatasetTableCol: opts.tableDatasetTableCol,
        geoDatasetName: opts.geoDatasetName,
        geoDatasetLayer: opts.geoDatasetLayer,
        geographyIds: [],
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
