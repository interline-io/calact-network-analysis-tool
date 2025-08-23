import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Polly } from '@pollyjs/core'
import { MockGraphQLClient } from '../graphql.test'
import { parseDate, parseTime } from '../datetime'
import { ScenarioFetcher, type ScenarioConfig, type ScenarioFilter } from './scenario'
import type { Bbox } from '~/src/geom'

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
    startDate: parseDate('2024-07-03'),
    endDate: parseDate('2024-07-10'),
    geographyIds: [],
    stopLimit: 100
  }
  const filter: ScenarioFilter = {
    startTime: parseTime('06:00:00'),
    endTime: parseTime('22:00:00'),
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
