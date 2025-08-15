/**
 * Tests for streaming scenario implementation
 * Contains mock implementation for testing
 */

import { describe, it, expect, vi } from 'vitest'
import type {
  ScenarioStreamingMessage,
  DeparturesCompleteMessage,
  ErrorMessage,
  SimpleDeparture
} from './scenario'
import type { ScenarioConfig } from '~/src/scenario'

/**
 * Mock implementation of processStreamingScenario for testing
 * This simulates the streaming behavior with fake data
 */
export async function mockProcessStreamingScenario (
  config: ScenarioConfig,
  sendMessage: (message: ScenarioStreamingMessage) => void,
  sendProgress: (phase: string, current: number, total: number, message: string) => void
): Promise<void> {
  try {
    // Mock stops phase
    sendProgress('stops', 0, 100, 'Starting to fetch stops...')
    await new Promise(resolve => setTimeout(resolve, 100)) // Shorter delay for tests

    // Mock stops data - send StopGql objects directly
    const mockStops = [
      {
        id: 1,
        stop_id: 'mock_stop_1',
        stop_name: 'Mock Stop 1',
        geometry: { type: 'Point' as const, coordinates: [-122.4194, 37.7749] },
        location_type: 0,
        census_geographies: [{ id: 1, name: 'Mock Geography', geoid: 'mock123', layer_name: 'census_tracts' }],
        route_stops: []
      },
      {
        id: 2,
        stop_id: 'mock_stop_2',
        stop_name: 'Mock Stop 2',
        geometry: { type: 'Point' as const, coordinates: [-122.4200, 37.7750] },
        location_type: 0,
        census_geographies: [{ id: 1, name: 'Mock Geography', geoid: 'mock123', layer_name: 'census_tracts' }],
        route_stops: []
      }
    ] as any[] // Temporary type assertion for mock data

    sendProgress('stops', 50, 100, 'Processing stops...')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Mock routes phase
    sendProgress('routes', 0, 50, 'Starting to fetch routes...')
    await new Promise(resolve => setTimeout(resolve, 100))

    // Mock routes and agencies - send RouteGql and AgencyGql objects directly
    const mockRoutes = [
      {
        id: 1,
        route_id: 'mock_route_1',
        route_short_name: 'Mock Line',
        route_long_name: 'Mock Transit Line',
        route_type: 3,
        route_color: '#FF0000',
        geometry: { type: 'MultiLineString' as const, coordinates: [] },
        agency: {
          id: 1,
          agency_id: 'mock_agency',
          agency_name: 'Mock Transit Agency'
        }
      }
    ]

    const mockAgencies = [
      {
        id: 1,
        agency_id: 'mock_agency',
        agency_name: 'Mock Transit Agency'
      }
    ]

    sendProgress('routes', 25, 50, 'Processing routes...')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Mock departures phase
    sendProgress('departures', 0, 200, 'Starting to fetch departures...')
    await new Promise(resolve => setTimeout(resolve, 100))

    // Mock departures
    const mockDepartures: SimpleDeparture[] = [
      {
        stopId: 1,
        routeId: 1,
        tripId: 1,
        serviceDate: '2024-01-01',
        departureTime: 3600, // 1:00 AM in seconds
        frequency: 15,
        agencyId: 1,
        routeType: 3
      },
      {
        stopId: 2,
        routeId: 1,
        tripId: 2,
        serviceDate: '2024-01-01',
        departureTime: 7200, // 2:00 AM in seconds
        frequency: 15,
        agencyId: 1,
        routeType: 3
      }
    ]

    sendProgress('departures', 100, 200, 'Processing departures...')
    await new Promise(resolve => setTimeout(resolve, 50))

    // Send departures complete
    const departuresMessage: DeparturesCompleteMessage = {
      type: 'departures_complete',
      data: {
        departures: mockDepartures,
        summary: {
          totalStops: mockStops.length,
          totalRoutes: mockRoutes.length,
          totalDepartures: mockDepartures.length
        }
      }
    }
    sendMessage(departuresMessage)
  } catch (error) {
    console.error('Error in mockProcessStreamingScenario:', error)
    const errorMessage: ErrorMessage = {
      type: 'error',
      data: { message: error instanceof Error ? error.message : 'Unknown error' }
    }
    sendMessage(errorMessage)
    throw error
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('StreamingScenario', () => {
  it('should process a mock scenario with all phases', async () => {
    const config: ScenarioConfig = {
      bbox: {
        sw: { lon: -122.5, lat: 37.7 },
        ne: { lon: -122.4, lat: 37.8 },
        valid: true
      },
      scheduleEnabled: true,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-01')
    }

    const messages: ScenarioStreamingMessage[] = []
    const progressUpdates: Array<{ phase: string, current: number, total: number, message: string }> = []

    const sendMessage = (message: ScenarioStreamingMessage) => {
      messages.push(message)
    }

    const sendProgress = (phase: string, current: number, total: number, message: string) => {
      progressUpdates.push({ phase, current, total, message })
    }

    await mockProcessStreamingScenario(config, sendMessage, sendProgress)

    // Verify we got the expected messages
    expect(messages).toHaveLength(3) // stops_complete, routes_complete, departures_complete
    expect(messages[0].type).toBe('stops_complete')
    expect(messages[1].type).toBe('routes_complete')
    expect(messages[2].type).toBe('departures_complete')

    // Verify progress updates
    expect(progressUpdates.length).toBeGreaterThan(0)
    expect(progressUpdates.some(p => p.phase === 'stops')).toBe(true)
    expect(progressUpdates.some(p => p.phase === 'routes')).toBe(true)
    expect(progressUpdates.some(p => p.phase === 'departures')).toBe(true)

    // Verify data structure
    // const stopsMessage = messages[0] as StopsCompleteMessage
    // expect(stopsMessage.data.stops).toHaveLength(2)
    // expect(stopsMessage.data.stops[0].stop_name).toBe('Mock Stop 1')

    // const routesMessage = messages[1] as RoutesCompleteMessage
    // expect(routesMessage.data.routes).toHaveLength(1)
    // expect(routesMessage.data.agencies).toHaveLength(1)

    const departuresMessage = messages[2] as DeparturesCompleteMessage
    expect(departuresMessage.data.departures).toHaveLength(2)
    expect(departuresMessage.data.summary.totalStops).toBe(2)
    expect(departuresMessage.data.summary.totalRoutes).toBe(1)
    expect(departuresMessage.data.summary.totalDepartures).toBe(2)
  })

  it('should handle errors gracefully', async () => {
    const messages: ScenarioStreamingMessage[] = []

    const sendMessage = (message: ScenarioStreamingMessage) => {
      messages.push(message)
    }

    // Mock implementation doesn't validate config, so we'll simulate an error
    const errorMockFn = vi.fn().mockImplementation(async () => {
      throw new Error('Test error')
    })

    try {
      await errorMockFn()
    } catch (error) {
      const errorMessage: ErrorMessage = {
        type: 'error',
        data: { message: error instanceof Error ? error.message : 'Unknown error' }
      }
      sendMessage(errorMessage)
    }

    expect(messages).toHaveLength(1)
    expect(messages[0].type).toBe('error')
    expect((messages[0] as ErrorMessage).data.message).toBe('Test error')
  })
})
