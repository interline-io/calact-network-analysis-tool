import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { ScenarioFetcher, GraphQLClient, type ScenarioConfig } from '../src/scenario-fetcher'
import { type Bbox } from '../src/geom'
import { setupPolly } from './pollySetup'
import { print } from 'graphql'
import type { Polly } from '@pollyjs/core'

/**
 * Real GraphQL client for testing with actual API calls
 */
class TestGraphQLClient extends GraphQLClient {
  private baseUrl: string
  private apiKey: string
  
  constructor(baseUrl: string, apiKey: string) {
    super()
    this.baseUrl = baseUrl
    this.apiKey = apiKey
  }
  
  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    // Extract query string from DocumentNode or use as-is if string
    let queryString: string
    if (typeof query === 'string') {
      queryString = query
    } else {
      // Use graphql print function to convert DocumentNode to string
      queryString = print(query)
    }
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'apikey': this.apiKey
    }
    
    const requestBody = {
      query: queryString,
      variables,
    }
    
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const result = await response.json()
      
      if (result.errors) {
        throw new Error(`GraphQL errors: ${result.errors.map((e: any) => e.message).join(', ')}`)
      }
      
      return result
    } catch (error) {
      console.error('GraphQL request failed:', error)
      throw error
    }
  }
}

/**
 * Mock GraphQL client for testing without real API calls
 */
class MockGraphQLClient extends GraphQLClient {
  public mockQuery: Mock

  constructor() {
    super()
    this.mockQuery = vi.fn()
  }

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

describe('ScenarioFetcher', () => {
  let mockClient: MockGraphQLClient
  let config: ScenarioConfig
  let polly: Polly | null = null

  beforeEach(() => {
    mockClient = new MockGraphQLClient()
    config = {
      bbox: {
        sw: { lat: 45.4, lon: -122.8 },
        ne: { lat: 45.7, lon: -122.5 },
        valid: true
      } as Bbox,
      scheduleEnabled: true,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-07'),
      startTime: new Date('2024-01-01T06:00:00'),
      endTime: new Date('2024-01-01T22:00:00'),
      selectedRouteTypes: [3],
      selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      selectedAgencies: [],
      selectedDayOfWeekMode: 'Any',
      selectedTimeOfDayMode: 'All',
      frequencyUnderEnabled: false,
      frequencyOverEnabled: false,
      geographyIds: []
    }
  })

  afterEach(async () => {
    if (polly) {
      await polly.stop()
      polly = null
    }
  })

  it('should create a ScenarioFetcher instance', () => {
    const fetcher = new ScenarioFetcher(config, mockClient)
    expect(fetcher).toBeInstanceOf(ScenarioFetcher)
  })

  it('should return current config', () => {
    const fetcher = new ScenarioFetcher(config, mockClient)
    const currentConfig = fetcher.getConfig()
    expect(currentConfig).toEqual(config)
    expect(currentConfig).not.toBe(config) // Should be a copy
  })

  it('should update config', () => {
    const fetcher = new ScenarioFetcher(config, mockClient)
    const newBbox = {
      sw: { lat: 40.0, lon: -120.0 },
      ne: { lat: 41.0, lon: -119.0 },
      valid: true
    }
    
    fetcher.updateConfig({ bbox: newBbox })
    const updatedConfig = fetcher.getConfig()
    
    expect(updatedConfig.bbox).toEqual(newBbox)
    expect(updatedConfig.scheduleEnabled).toBe(true) // Other properties should remain
  })

  it('should handle empty stops response', async () => {
    // Mock empty stops response
    mockClient.mockQuery.mockResolvedValue({ data: { stops: [] } })
    
    const progressCallback = vi.fn()
    const errorCallback = vi.fn()
    
    const fetcher = new ScenarioFetcher(config, mockClient, {
      onProgress: progressCallback,
      onError: errorCallback
    })

    // Should throw error when no stops are found
    await expect(fetcher.fetch()).rejects.toThrow('No transit stops found in the specified geographic area')
    expect(progressCallback).toHaveBeenCalled()
    expect(errorCallback).toHaveBeenCalled()
  })

  it('should handle stops with routes', async () => {
    const mockStops = [
      {
        id: 1,
        stop_id: 'stop_1',
        stop_name: 'Test Stop 1',
        location_type: 0,
        geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
        census_geographies: [],
        route_stops: [
          {
            route: {
              id: 101,
              route_id: 'route_101',
              route_type: 3,
              route_short_name: 'R1',
              route_long_name: 'Route 1',
              agency: {
                id: 1,
                agency_id: 'agency_1',
                agency_name: 'Test Agency'
              }
            }
          }
        ]
      }
    ]

    const mockRoutes = [
      {
        id: 101,
        route_id: 'route_101',
        route_type: 3,
        route_short_name: 'R1',
        route_long_name: 'Route 1',
        geometry: { type: 'MultiLineString', coordinates: [] },
        agency: {
          id: 1,
          agency_id: 'agency_1',
          agency_name: 'Test Agency'
        }
      }
    ]

    // Mock responses for stops, routes, and departures
    mockClient.mockQuery
      .mockResolvedValueOnce({ data: { stops: mockStops } }) // First stops call
      .mockResolvedValueOnce({ data: { routes: mockRoutes } }) // Routes call
      .mockResolvedValueOnce({ data: { stops: [] } }) // Second stops call (empty, ends recursion)
      .mockResolvedValue({ data: { stops: [] } }) // Any departure calls

    const fetcher = new ScenarioFetcher(config, mockClient)
    const result = await fetcher.fetch()

    expect(result.stops).toHaveLength(1)
    expect(result.routes).toHaveLength(1)
    expect(result.stops[0].id).toBe(1)
    expect(result.routes[0].id).toBe(101)
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

  it('should respect scheduleEnabled flag', async () => {
    const configWithoutSchedule = { ...config, scheduleEnabled: false }
    
    // Mock at least one stop to pass validation
    mockClient.mockQuery.mockResolvedValue({ data: { stops: [
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
    
    const fetcher = new ScenarioFetcher(configWithoutSchedule, mockClient)
    const result = await fetcher.fetch()

    // Should still work but skip departure queries
    expect(result.isComplete).toBe(true)
  })

  it('should call progress callback during fetch', async () => {
    // Mock at least one stop to pass validation
    mockClient.mockQuery.mockResolvedValue({ data: { stops: [
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
  let realClient: TestGraphQLClient
  let config: ScenarioConfig

  beforeEach(() => {
    // Use API key from environment
    const apiKey = process.env.TRANSITLAND_API_KEY || 'test-api-key'
    realClient = new TestGraphQLClient('https://api.transit.land/api/v2/query', apiKey)
    
    // Use a small, well-known area for consistent test data - Downtown Portland
    config = {
      bbox: {
        sw: { lat: 45.51358, lon: -122.69075 },
        ne: { lat: 45.53306, lon: -122.66809 },
        valid: true
      } as Bbox,
      scheduleEnabled: false, // Disable schedule for faster tests
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-02'), // Short date range
      startTime: new Date('2024-01-01T08:00:00'),
      endTime: new Date('2024-01-01T10:00:00'),
      selectedRouteTypes: [3], // Bus only
      selectedDays: ['monday'],
      selectedAgencies: [],
      selectedDayOfWeekMode: 'Any',
      selectedTimeOfDayMode: 'All',
      frequencyUnderEnabled: false,
      frequencyOverEnabled: false,
      geographyIds: []
    }
  })

  afterEach(async () => {
    if (polly) {
      await polly.stop()
    }
  })

  it('should fetch real transit data from Portland area (no schedule)', async () => {
    polly = setupPolly('scenario-fetcher-portland-basic')
    
    const fetcher = new ScenarioFetcher(config, realClient)
    const result = await fetcher.fetch()

    // Should have found some stops and routes in downtown Portland
    expect(result.stops.length).toBeGreaterThan(0)
    expect(result.routes.length).toBeGreaterThan(0)
    expect(result.agencies.length).toBeGreaterThan(0)
    expect(result.isComplete).toBe(true)

    // Check that we have realistic data
    const firstStop = result.stops[0]
    expect(firstStop).toHaveProperty('stop_name')
    expect(firstStop).toHaveProperty('geometry')
    expect(firstStop.geometry.coordinates).toHaveLength(2)
    
    const firstRoute = result.routes[0]
    expect(firstRoute).toHaveProperty('route_name')
    expect(firstRoute).toHaveProperty('agency_name')
    expect(firstRoute.route_type).toBe(3) // Should be bus as filtered

    console.log(`Found ${result.stops.length} stops, ${result.routes.length} routes, ${result.agencies.length} agencies`)
  }, 180000) // 180 second timeout


  it('should handle API errors gracefully', async () => {
    polly = setupPolly('scenario-fetcher-api-error')
    
    // Use invalid API key to trigger error
    const badClient = new TestGraphQLClient('https://api.transit.land/api/v2/query', 'invalid-key')
    const fetcher = new ScenarioFetcher(config, badClient)

    await expect(fetcher.fetch()).rejects.toThrow()
  }, 15000)
})
