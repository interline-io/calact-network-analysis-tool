#!/usr/bin/env node
// Run with: yarn calact <subcommand>

import { Command } from 'commander'
import { configureScenarioCli } from './scenario-cli'
import { configureWsdotReportCli } from './wsdot-cli'

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

// Create WSDOT report subcommand
const wsdotCommand = program
  .command('wsdot')
  .description('Generate WSDOT network analysis report')

configureWsdotReportCli(wsdotCommand)

program.parse(process.argv)
