/**
 * Tests for streaming scenario implementation
 * Contains mock implementation for testing
 */

import { existsSync, unlinkSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, it, expect, vi } from 'vitest'
import { ScenarioDataReceiver } from './scenario-streaming'
import type { ScenarioConfig, ScenarioCallbacks, ScenarioData } from '~/src/scenario'

// ============================================================================
// IN-PROCESS SCENARIO FETCHER
// ============================================================================

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

    // First add some data through progress
    receiver.onProgress({
      isLoading: true,
      stopDepartureProgress: { total: 0, completed: 0 },
      feedVersionProgress: { total: 100, completed: 100 },
      currentStage: 'complete',
      partialData: {
        stops: [{ id: 1, stop_name: 'Final Stop' } as any],
        routes: [{ id: 1, route_short_name: 'Final Route' } as any],
        feedVersions: []
      }
    })

    // Call onComplete (no parameters, matching ScenarioCallbacks interface)
    receiver.onComplete()

    expect(mockComplete).toHaveBeenCalledWith()
    expect(receiver.getCurrentData().isComplete).toBe(true)
  })

  it('should handle errors correctly', () => {
    const mockError = vi.fn()
    const receiver = new ScenarioDataReceiver({ onError: mockError })

    const error = new Error('Test error')
    receiver.onError(error)

    expect(mockError).toHaveBeenCalledWith(error)
  })

  it('should save progress to file stream when saveStream is called', async () => {
    const testFilename = join(tmpdir(), `test-stream-${Date.now()}.jsonl`)
    const receiver = new ScenarioDataReceiver()

    // Start streaming to file
    receiver.saveStream(testFilename)

    // Send some progress data
    receiver.onProgress({
      isLoading: true,
      stopDepartureProgress: { total: 0, completed: 0 },
      feedVersionProgress: { total: 100, completed: 50 },
      currentStage: 'stops',
      partialData: {
        stops: [{ id: 1, stop_name: 'Test Stop' } as any],
        routes: [],
        feedVersions: []
      }
    })

    // Send completion and wait for stream to close
    receiver.onComplete()

    // Give the stream a moment to finish writing
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify file was created and contains expected content
    expect(existsSync(testFilename)).toBe(true)

    const fileContent = readFileSync(testFilename, 'utf8')
    const lines = fileContent.trim().split('\n')

    expect(lines).toHaveLength(2) // progress + complete

    // Parse and verify progress message
    const progressMessage = JSON.parse(lines[0])
    expect(progressMessage.type).toBe('progress')
    expect(progressMessage.data.currentStage).toBe('stops')
    expect(progressMessage.data.partialData.stops).toHaveLength(1)

    // Parse and verify complete message
    const completeMessage = JSON.parse(lines[1])
    expect(completeMessage.type).toBe('complete')
    expect(completeMessage.data.isComplete).toBe(true)

    // Clean up
    if (existsSync(testFilename)) {
      unlinkSync(testFilename)
    }
  })

  it('should save error to file stream when saveStream is active', async () => {
    const testFilename = join(tmpdir(), `test-error-stream-${Date.now()}.jsonl`)
    const receiver = new ScenarioDataReceiver()

    // Start streaming to file
    receiver.saveStream(testFilename)

    // Send error
    const error = new Error('Test error')
    receiver.onError(error)

    // Give the stream a moment to finish writing
    await new Promise(resolve => setTimeout(resolve, 100))

    // Verify file was created and contains expected content
    expect(existsSync(testFilename)).toBe(true)

    const fileContent = readFileSync(testFilename, 'utf8')
    const lines = fileContent.trim().split('\n')

    expect(lines).toHaveLength(1) // error message

    // Parse and verify error message
    const errorMessage = JSON.parse(lines[0])
    expect(errorMessage.type).toBe('error')
    expect(errorMessage.data.message).toBe('Test error')

    // Clean up
    if (existsSync(testFilename)) {
      unlinkSync(testFilename)
    }
  })
})
