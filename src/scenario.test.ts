import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Polly } from '@pollyjs/core'
import { ScenarioFetcher, type ScenarioConfig, type ScenarioFilter } from './scenario'
import type { Bbox } from './geom'
import { MockGraphQLClient, TestGraphQLClient } from './testutil'
import { setupPolly } from '~/tests/pollySetup'

describe('ScenarioFetcher', () => {
  const mockClient: MockGraphQLClient = new MockGraphQLClient()
  let polly: Polly | null = null
  const config: ScenarioConfig = {
    bbox: {
      sw: { lat: 45.4, lon: -122.8 },
      ne: { lat: 45.7, lon: -122.5 },
      valid: true
    } as Bbox,
    scheduleEnabled: true,
    startDate: new Date('2024-07-03'),
    endDate: new Date('2024-07-10'),
    geographyIds: [],
    stopLimit: 100
  }
  const filter: ScenarioFilter = {
    startTime: new Date('2024-07-03T06:00:00'),
    endTime: new Date('2024-07-03T22:00:00'),
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

  it('should handle GraphQL errors', async () => {
    const mockError = new Error('GraphQL Error')
    mockClient.mockQuery.mockRejectedValue(mockError)

    const errorCallback = vi.fn()
    const fetcher = new ScenarioFetcher(config, mockClient, {
      onError: errorCallback
    })

    await expect(fetcher.fetch()).rejects.toThrow('GraphQL Error')
    expect(errorCallback).toHaveBeenCalledWith(mockError)
  })

  it('should call progress callback during fetch', async () => {
    // Mock first call returns one stop, second call returns empty to end recursion
    mockClient.mockQuery
      .mockResolvedValueOnce({ data: { stops: [
        {
          id: 1,
          stop_id: 'stop_1',
          stop_name: 'Test Stop',
          location_type: 0,
          geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
          census_geographies: [],
          route_stops: []
        }
      ] } })
      .mockResolvedValue({ data: { stops: [] } }) // All subsequent calls return empty

    const progressCallback = vi.fn()
    const fetcher = new ScenarioFetcher(config, mockClient, {
      onProgress: progressCallback
    })

    await fetcher.fetch()

    // Should be called at least twice (start loading, stop loading)
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: true })
    )
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: false })
    )
  })
})

describe('ScenarioFetcher Integration Tests (with PollyJS)', () => {
  let polly: Polly
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
    startDate: new Date('2024-07-03'),
    endDate: new Date('2024-07-04'), // Short date range
    geographyIds: [],
    stopLimit: 100
  }
  const filter: ScenarioFilter = {
    startTime: new Date('2024-07-03T08:00:00'),
    endTime: new Date('2024-07-03T10:00:00'),
    selectedRouteTypes: [3], // Bus only
    selectedDays: ['monday'],
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
    }
  })

  it('should fetch real transit data from Portland area', async () => {
    polly = setupPolly('scenario-fetcher-portland-basic')

    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()

    // Should have found some stops and routes in downtown Portland
    expect(result.stops.length).toBeGreaterThan(0)
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.isComplete).toBe(true)

    // Check that we have realistic data
    const firstStop = result.stops[0]
    expect(firstStop).toHaveProperty('stop_name')
    expect(firstStop).toHaveProperty('geometry')
    expect(firstStop.geometry.coordinates).toHaveLength(2)

    const firstRoute = result.routes[0]
    expect(firstRoute).toHaveProperty('route_short_name')
    expect(firstRoute.route_type).toBe(3) // Should be bus as filtered

    console.log(`Found ${result.stops.length} stops, ${result.routes.length} routes`)
  }, 60000)
})
