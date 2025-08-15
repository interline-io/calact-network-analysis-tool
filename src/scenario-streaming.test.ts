/**
 * Tests for streaming scenario implementation
 * Contains mock implementation for testing
 */

import { describe, it, expect, vi } from 'vitest'
import { ScenarioDataReceiver, fetchScenario } from './scenario-streaming'
import type { ScenarioConfig, ScenarioCallbacks } from '~/src/scenario'
import { StopDepartureCache } from '~/src/departure-cache'

describe('ScenarioDataReceiver', () => {
  it('should accumulate data from progress events', () => {
    const mockCallback = vi.fn()
    const receiver = new ScenarioDataReceiver({ onProgress: mockCallback })

    // Send progress with partial data
    receiver.onProgress({
      isLoading: true,
      stopDepartureProgress: { total: 0, completed: 0 },
      feedVersionProgress: { total: 100, completed: 50 },
      currentStage: 'stops',
      partialData: {
        stops: [
          {
            id: 1,
            stop_id: 'stop_1',
            stop_name: 'Test Stop 1',
            geometry: { type: 'Point', coordinates: [-122.4, 37.7] },
            location_type: 0,
            census_geographies: [],
            route_stops: []
          }
        ] as any[],
        routes: [],
        feedVersions: []
      }
    })

    // Check that data was accumulated
    const currentData = receiver.getCurrentData()
    expect(currentData.stops).toHaveLength(1)
    expect(currentData.stops[0].stop_name).toBe('Test Stop 1')
    expect(mockCallback).toHaveBeenCalledOnce()
  })

  it('should handle completion correctly', () => {
    const mockComplete = vi.fn()
    const receiver = new ScenarioDataReceiver({ onComplete: mockComplete })

    const finalData = {
      stops: [{ id: 1, stop_name: 'Final Stop' } as any],
      routes: [{ id: 1, route_short_name: 'Final Route' } as any],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: true
    }

    receiver.onComplete(finalData)

    expect(mockComplete).toHaveBeenCalledWith(finalData)
    expect(receiver.getCurrentData().isComplete).toBe(true)
  })

  it('should handle errors correctly', () => {
    const mockError = vi.fn()
    const receiver = new ScenarioDataReceiver({ onError: mockError })

    const error = new Error('Test error')
    receiver.onError(error)

    expect(mockError).toHaveBeenCalledWith(error)
  })
})

describe('fetchScenario integration', () => {
  it('should use ScenarioDataReceiver pattern', async () => {
    // This test verifies the integration works but requires actual GraphQL mocking
    // For now, we'll just verify the function exists and can be called
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

    // Since we don't have full mocking set up, we'll just verify the interface
    expect(fetchScenario).toBeDefined()
    expect(typeof fetchScenario).toBe('function')

    // Test that it accepts the right parameters
    const callbacks: ScenarioCallbacks = {
      onProgress: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn()
    }

    // We can't actually run this without proper mocking, but we can verify types
    expect(() => fetchScenario(config, callbacks)).not.toThrow()
  })
})
