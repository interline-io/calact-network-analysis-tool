/**
 * Simple CLI example showing how to use ScenarioFetcher
 */

import type { Command } from 'commander'
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  scenarioOutputCsv,
  scenarioOutputSummary,
  scenarioSaveData,
  type ScenarioCliOptions
} from './scenario-cli-util'
import { ScenarioFetcher, type ScenarioData, type ScenarioConfig, type ScenarioCallbacks } from '~/src/scenario'
import { ScenarioDataReceiver } from '~/src/scenario-streaming'
import { parseBbox } from '~/src/geom'
import { BasicGraphQLClient } from '~/src/graphql'
import { parseDate } from '~/src/datetime'

/**
 * Configure scenario CLI command
 */
export function configureScenarioCli (program: Command) {
  scenarioOptionsAdd(program)
    .allowUnknownOption(false)
    .action(async (options) => {
      await runScenarioCli(options as ScenarioCliOptions)
    })
}

/**
 * Execute scenario CLI with given options
 */
async function runScenarioCli (options: ScenarioCliOptions) {
  scenarioOptionsCheck(options)
  await runScenarioData(options)
}

export async function runScenarioData (options: ScenarioCliOptions): Promise<ScenarioData> {
  console.log('🚌 Starting transit scenario fetch...')

  // Parse configuration from CLI options
  const config: ScenarioConfig = {
    bbox: options.bbox ? parseBbox(options.bbox) : undefined,
    scheduleEnabled: !options.noSchedule,
    startDate: parseDate(options.startDate)!,
    endDate: parseDate(options.endDate)!,
    geographyIds: []
  }

  // Create GraphQL client
  const client = new BasicGraphQLClient(
    options.endpoint,
    process.env.TRANSITLAND_API_KEY || ''
  )

  // Create callback functions for progress reporting
  const callbacks: ScenarioCallbacks = {
    onError: (error) => {
      console.error('❌ Error during fetch:', error.message)
    }
  }

  // Create receiver to accumulate data
  const receiver = new ScenarioDataReceiver(callbacks)

  // Create scenario fetcher with receiver callbacks
  const fetcher = new ScenarioFetcher(config, client, {
    onProgress: progress => receiver.onProgress(progress),
    onComplete: () => receiver.onComplete(),
    onError: error => receiver.onError(error)
  })

  // Execute the fetch
  await fetcher.fetch()
  const result = receiver.getCurrentData()

  console.log('✅ Fetch completed!')
  // Save scenario data if requested
  if (options.saveScenarioData) {
    await scenarioSaveData(options.saveScenarioData, result, config)
  }

  // Output results based on format
  switch (options.output) {
    case 'json':
      console.log(JSON.stringify(result, null, '  '))
      break

    case 'csv':
      scenarioOutputCsv(result)
      break

    case 'summary':
    default:
      scenarioOutputSummary(result)
      break
  }

  return result
}
