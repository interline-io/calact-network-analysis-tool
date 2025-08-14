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

// Create scenario subcommand
const scenarioCommand = program
  .command('scenario')
  .description('Fetch transit scenario data via CLI')

configureScenarioCli(scenarioCommand)

program.parse(process.argv)
