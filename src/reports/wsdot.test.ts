import { describe, it, afterEach } from 'vitest'
import type { Polly } from '@pollyjs/core'
import { parseDate } from '~/src/datetime'
import { BasicGraphQLClient } from '~/src/graphql'
import { ScenarioFetcher } from '~/src/scenario/scenario'
import type { Bbox } from '~/src/geom'
import { WSDOTReportFetcher, type WSDOTReportConfig } from '~/src/reports/wsdot'

describe.skipIf(process.env.TEST_WSDOT !== 'true')('wsdot', () => {
  if (process.env.TEST_WSDOT !== 'true') {
    // Skip test if TEST_WSDOT is not set to 'true'
    return
  }
  let polly: Polly | null = null
  const realClient: BasicGraphQLClient = new BasicGraphQLClient(
    process.env.TRANSITLAND_API_ENDPOINT || '',
    process.env.TRANSITLAND_API_KEY || '',
  )

  afterEach(async () => {
    if (polly) {
      await polly.stop()
      polly = null
    }
  })

  const smallBbox: Bbox = {
    sw: { lon: -122.375034, lat: 47.586920 },
    ne: { lon: -122.265815, lat: 47.625345 },
    valid: true
  }
  const bigBbox: Bbox = {
    sw: { lon: -127.300423, lat: 44.772916 },
    ne: { lon: -113.320321, lat: 47.625345 },
    valid: true
  }

  it('thomas-2024', async () => {
    // polly = setupPolly('scenario-wsdot-1')
    const startDate = '2024-08-19'
    const endDate = '2024-08-25'
    const config: WSDOTReportConfig = {
      bbox: bigBbox,
      scheduleEnabled: true,
      startDate: parseDate(startDate)!,
      endDate: parseDate('2024-08-26')!, // FIXME: must be one day past window
      weekdayDate: parseDate(startDate)!,
      weekendDate: parseDate(endDate)!,
      geographyIds: [],
      stopLimit: 1000
    }
    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()
    const wsdotFetcher = new WSDOTReportFetcher(config, result, realClient)
    const report = await wsdotFetcher.fetch()
    console.log(report.levelStops)
  })

  it('tlv2-prod', async () => {
    // polly = setupPolly('scenario-wsdot-2')
    const startDate = '2025-08-11'
    const endDate = '2025-08-18'
    const config: WSDOTReportConfig = {
      bbox: smallBbox,
      scheduleEnabled: true,
      startDate: parseDate(startDate)!,
      endDate: parseDate('2025-08-19')!, // FIXME: must be one day past window
      weekdayDate: parseDate(startDate)!,
      weekendDate: parseDate(endDate)!,
      geographyIds: [],
      stopLimit: 1000
    }
    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()
    const wsdotFetcher = new WSDOTReportFetcher(config, result, realClient)
    const report = await wsdotFetcher.fetch()
    console.log(report.levelStops)
  })
}, 600000)
