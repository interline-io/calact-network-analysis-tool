import { describe, it, afterEach } from 'vitest'
import type { Polly } from '@pollyjs/core'
import { TestGraphQLClient } from '~/src/testutil'
import type { ScenarioConfig, ScenarioFilter } from '~/src/scenario'
import { ScenarioFetcher } from '~/src/scenario'
import type { Bbox } from '~/src/geom'
import { wsdotReport } from '~/src/reports/wsdot'

// big -127.300423,44.772916,-113.320321,49.719907
// small -122.375034,47.586920,-122.265815,47.625345
describe('wsdot', () => {
  let polly: Polly | null = null
  const realClient: TestGraphQLClient = new TestGraphQLClient(
    process.env.TLSERVER_TEST_ENDPOINT || '',
    process.env.TRANSITLAND_API_KEY || '',
  )
  const startDate = '2024-08-19'
  const endDate = '2024-08-25' // FIXME: must be one day past window
  const config: ScenarioConfig = {
    bbox: {
      sw: { lon: -127.300423, lat: 44.772916 },
      ne: { lon: -113.320321, lat: 47.625345 },
      // sw: { lon: -122.375034, lat: 47.586920 },
      // ne: { lon: -122.265815, lat: 47.625345 },
      valid: true
    } as Bbox,
    scheduleEnabled: true,
    startDate: new Date(startDate),
    endDate: new Date('2024-08-26'),
    geographyIds: [],
    stopLimit: 1000
  }
  const filter: ScenarioFilter = {
    selectedRouteTypes: [3],
    selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    selectedAgencies: [],
    selectedDayOfWeekMode: 'Any',
    selectedTimeOfDayMode: 'All',
    frequencyUnderEnabled: false,
    frequencyOverEnabled: false,
  }
  console.log(config, filter)

  afterEach(async () => {
    if (polly) {
      await polly.stop()
      polly = null
    }
  })

  it('test', async () => {
    // polly = setupPolly('scenario-wsdot-1')
    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()
    const report = wsdotReport(result, startDate, endDate)
    console.log(report.levelCounts)
  })
}, 600000)
