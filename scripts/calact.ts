#!/usr/bin/env node
// Run with: yarn calact <subcommand>
import 'dotenv/config'

import { Command } from 'commander'
import { configureScenarioCli } from './scenario-cli'
import { configureWsdotReportCli } from './wsdot-cli'
import { configureWsdotStopsRoutesReportCli } from './wsdot-stops-routes-cli'

const program = new Command()

program
  .name('calact')
  .description('CalAct CLI Tool')
  .version('1.0.0')
  .allowUnknownOption(false)

// Create scenario subcommand
const scenarioCommand = program
  .command('scenario')
  .description('Fetch transit scenario data via CLI')

configureScenarioCli(scenarioCommand)

// WSDOT subcommand
const wsdotCommand = program
  .command('wsdot')
  .description('Fetch WSDOT report data via CLI')

configureWsdotReportCli(wsdotCommand)

// WSDOT Stops and Routes subcommand
const wsdotStopsRoutesCommand = program
  .command('wsdot-stops-routes')
  .description('Fetch WSDOT stops and routes report data via CLI')

configureWsdotStopsRoutesReportCli(wsdotStopsRoutesCommand)

program.parse(process.argv)
