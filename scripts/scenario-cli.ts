/**
 * Simple CLI example showing how to use ScenarioFetcher
 */

import type { Command } from 'commander'

// Local utilities
import {
  scenarioOptionsAdd,
  scenarioOptionsCheck,
  scenarioOutputCsv,
  scenarioOutputSummary,
  type ScenarioCliOptions
} from './scenario-cli-util'

// Core scenario functionality
import type { ScenarioData, ScenarioConfig } from '~/src/scenario/scenario'
import { ScenarioDataReceiver, ScenarioFetcher } from '~/src/scenario/scenario-fetcher'
import { ScenarioStreamReceiver, ScenarioStreamSender } from '~/src/scenario/scenario-streamer'

// Utilities
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
    process.env.TRANSITLAND_API_ENDPOINT || '',
    process.env.TRANSITLAND_API_KEY || ''
  )

  // Create a transform stream that optionally multiplexes to file
  let fileStream: import('fs').WriteStream | undefined
  if (options.saveScenarioData) {
    fileStream = await import('fs').then(fs => fs.createWriteStream(options.saveScenarioData!))
    console.log(`📝 Logging scenario data to: ${options.saveScenarioData}`)
  }
  const { writable, readable } = new TransformStream({
    transform (chunk, controller) {
      controller.enqueue(chunk)
      fileStream?.write(chunk)
    },
    flush () {
      fileStream?.end()
    }
  })
  const writer = writable.getWriter()

  // Configure fetcher/sender
  const scenarioDataSender = new ScenarioStreamSender(writer)
  const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

  // Configure client/receiver
  const receiver = new ScenarioDataReceiver()
  const scenarioDataClient = new ScenarioStreamReceiver()

  // Await data - start both concurrently and wait for both to complete
  await Promise.all([
    fetcher.fetch(),
    scenarioDataClient.processStream(readable, receiver)
  ])

  const result = receiver.getCurrentData()
  console.log('✅ Fetch completed!')

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
