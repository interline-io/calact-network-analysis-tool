#!/usr/bin/env node
// Run with: yarn calact <subcommand>

import { Command } from 'commander'
import { configureScenarioCli } from './scenario-cli'

const program = new Command()

program
  .name('calact')
  .description('CalAct CLI Tool')
  .version('1.0.0')
  .allowUnknownOption(false)

// Create scenario-cli subcommand
const scenarioCliCommand = program
  .command('scenario-cli')
  .description('Fetch transit scenario data via CLI')

configureScenarioCli(scenarioCliCommand)

program.parse(process.argv)
