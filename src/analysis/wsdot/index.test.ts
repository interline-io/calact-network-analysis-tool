import { describe, it, afterEach } from 'vitest'
import { parseDate, apiFetch, BasicGraphQLClient, type Bbox, DEFAULT_CENSUS_DATASET, DEFAULT_GEODATA_DATASET } from '~/src/core'
import { runScenarioFetcher, ScenarioStreamSender } from '~/src/scenario'
import { WSDOTReportFetcher, type WSDOTReportConfig } from '~/src/analysis/wsdot'

describe.skipIf(process.env.TEST_WSDOT !== 'true')('wsdot', () => {
  if (process.env.TEST_WSDOT !== 'true') {
    // Skip test if TEST_WSDOT is not set to 'true'
    return
  }
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || ''),
  )

  afterEach(async () => {
    // Cleanup if needed
  })

  const smallBbox: Bbox = {
    sw: { lon: -122.375034, lat: 47.586920 },
    ne: { lon: -122.265815, lat: 47.625345 },
    valid: true,
  }
  const bigBbox: Bbox = {
    sw: { lon: -127.300423, lat: 44.772916 },
    ne: { lon: -113.320321, lat: 47.625345 },
    valid: true,
  }

  it('thomas-2024', async () => {
    // polly = setupPolly('scenario-wsdot-1')
    const startDate = '2024-08-19'
    const endDate = '2024-08-25'
    const config: WSDOTReportConfig = {
      reportName: 'Test Report',
      bbox: bigBbox,
      scheduleEnabled: true,
      startDate: parseDate(startDate)!,
      endDate: parseDate('2024-08-26')!, // FIXME: must be one day past window
      weekdayDate: parseDate(startDate)!,
      weekendDate: parseDate(endDate)!,
      geographyIds: [],
      routeHourCompatMode: true,
      stopLimit: 1000,
      stopBufferRadius: 800,
      tableDatasetName: DEFAULT_CENSUS_DATASET,
      tableDatasetTable: 'b01001',
      tableDatasetTableCol: 'b01001_001',
      geoDatasetName: DEFAULT_GEODATA_DATASET,
      geoDatasetLayer: 'tract',
      aggregateLayer: 'state',

    }

    const controller = createStreamController()
    const scenarioData = await runScenarioFetcher(controller, config, client)
    const mockSender = createMockSender()
    const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client, mockSender)
    await wsdotFetcher.fetch()
    console.log('Test completed')
  })

  it('tlv2-prod', async () => {
    // polly = setupPolly('scenario-wsdot-2')
    const startDate = '2025-08-11'
    const endDate = '2025-08-18'
    const config: WSDOTReportConfig = {
      reportName: 'Test Report',
      bbox: smallBbox,
      scheduleEnabled: true,
      startDate: parseDate(startDate)!,
      endDate: parseDate('2025-08-19')!, // FIXME: must be one day past window
      weekdayDate: parseDate(startDate)!,
      weekendDate: parseDate(endDate)!,
      geographyIds: [],
      routeHourCompatMode: true,
      stopLimit: 1000,
      stopBufferRadius: 800,
      tableDatasetName: DEFAULT_CENSUS_DATASET,
      tableDatasetTable: 'b01001',
      tableDatasetTableCol: 'b01001_001',
      geoDatasetName: DEFAULT_GEODATA_DATASET,
      geoDatasetLayer: 'tract',
      aggregateLayer: 'state',
    }
    const controller = createStreamController()
    const scenarioData = await runScenarioFetcher(controller, config, client)
    const mockSender = createMockSender()
    const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client, mockSender)
    await wsdotFetcher.fetch()
    console.log('Test completed')
  })
}, 600000)

function createMockSender () {
  const { writable } = new TransformStream()
  return new ScenarioStreamSender(writable.getWriter())
}

export function createStreamController (): ReadableStreamDefaultController {
  let controller: ReadableStreamDefaultController
  return controller!
}
