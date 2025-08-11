import { describe, it, afterEach } from 'vitest'
import type { Polly } from '@pollyjs/core'
import { TestGraphQLClient } from '~/src/testutil'
import type { ScenarioConfig, ScenarioFilter } from '~/src/scenario'
import { ScenarioFetcher } from '~/src/scenario'
import type { Bbox } from '~/src/geom'
import { setupPolly } from '~/tests/pollySetup'
import { wsdotReport } from '~/src/reports/wsdot'

describe('wsdot', () => {
  let polly: Polly | null = null
  const realClient: TestGraphQLClient = new TestGraphQLClient(
    process.env.TLSERVER_TEST_ENDPOINT || '',
    process.env.TRANSITLAND_API_KEY || '',
  )
  const config: ScenarioConfig = {
    bbox: {
      sw: { lat: 45.51358, lon: -122.69075 },
      ne: { lat: 45.53306, lon: -122.66809 },
      valid: true
    } as Bbox,
    scheduleEnabled: true,
    startDate: new Date('2025-07-03'),
    endDate: new Date('2025-07-10'),
    geographyIds: [],
    stopLimit: 100
  }
  const filter: ScenarioFilter = {
    // startTime: new Date('2025-07-03T06:00:00'),
    // endTime: new Date('2025-07-03T22:00:00'),
    selectedRouteTypes: [3],
    selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
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
    polly = setupPolly('scenario-wsdot-1')
    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()
    const report = wsdotReport(result, '2025-07-03')
    console.log(report)
  })
})
