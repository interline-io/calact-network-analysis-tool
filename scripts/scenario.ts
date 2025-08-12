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
} from './util'
import { ScenarioFetcher, type ScenarioData, type ScenarioConfig } from '~/src/scenario'
import { parseBbox } from '~/src/geom'
import { BasicGraphQLClient } from '~/src/graphql'

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
    scheduleEnabled: options.schedule,
    startDate: new Date(options.startDate),
    endDate: new Date(options.endDate),
    geographyIds: []
  }

  // Create GraphQL client
  const client = new BasicGraphQLClient(
    options.endpoint,
    process.env.TRANSITLAND_API_KEY || ''
  )

  // Create scenario fetcher with progress reporting
  const fetcher = new ScenarioFetcher(config, client, {
    onProgress: (progress) => {
      if (progress.isLoading) {
        const { completed, total } = progress.stopDepartureProgress
        if (total > 0) {
          console.log(`⏳ Loading... (${completed}/${total} completed)`)
        } else {
          console.log('⏳ Loading...')
        }
      }
    },
    onError: (error) => {
      console.error('❌ Error during fetch:', error.message)
    }
  })

  // Execute the fetch
  const result = await fetcher.fetch()

  console.log('✅ Fetch completed!')
  // Save scenario data if requested
  if (options.saveScenarioData) {
    await scenarioSaveData(options.saveScenarioData, result, config)
  }

  // Output results based on format
  switch (options.output) {
    case 'json':
      console.log(JSON.stringify(result, null, 2))
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
