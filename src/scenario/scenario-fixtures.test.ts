import { unlink } from 'fs/promises'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import type { ScenarioConfig, ScenarioFilter, ScenarioData } from './scenario'
import { StopDepartureCache } from './departure-cache'
import {
  saveScenarioTestFixtureToFile,
  loadScenarioTestFixtureFromFile,
  type ScenarioTestFixture
} from './scenario-fixtures'
import type { Bbox } from '~/src/geom'

describe('Scenario Fixtures', () => {
  const testFilePath = join(process.cwd(), 'tmp', 'test-scenario-fixture.json')

  // Clean up test file after each test
  async function cleanup () {
    try {
      await unlink(testFilePath)
    } catch {
      // File doesn't exist, that's fine
    }
  }

  it('should save and load complete ScenarioTestFixture with all components', async () => {
    // Create test config with dates
    const testConfig: ScenarioConfig = {
      bbox: {
        sw: { lat: 45.4, lon: -122.8 },
        ne: { lat: 45.7, lon: -122.5 },
        valid: true
      } as Bbox,
      scheduleEnabled: true,
      startDate: new Date('2024-07-03'),
      endDate: new Date('2024-07-10'),
      geographyIds: [12345],
      stopLimit: 500
    }

    // Create test filter with dates and complex settings
    const testFilter: ScenarioFilter = {
      startTime: new Date('2024-07-03T06:00:00'),
      endTime: new Date('2024-07-03T22:00:00'),
      selectedRouteTypes: [3, 1],
      selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      selectedAgencies: ['agency-1', 'agency-2'],
      selectedDayOfWeekMode: 'All',
      selectedTimeOfDayMode: 'Peak',
      frequencyUnder: 30,
      frequencyOver: 10,
      frequencyUnderEnabled: true,
      frequencyOverEnabled: false
    }

    // Create test data with complex structures
    const testData: ScenarioData = {
      routes: [{
        id: 1,
        route_id: 'test-route-1',
        route_short_name: 'Route 1',
        route_long_name: 'Test Route 1',
        route_type: 3,
        route_desc: '',
        route_url: '',
        route_color: '',
        route_text_color: '',
        route_sort_order: 0,
        continuous_pickup: 0,
        continuous_drop_off: 0,
        geometry: {
          type: 'MultiLineString',
          coordinates: []
        },
        agency: {
          id: 1,
          agency_id: 'test-agency',
          agency_name: 'Test Agency'
        }
      }],
      stops: [{
        id: 100,
        stop_id: 'test-stop-1',
        stop_name: 'Test Stop 1',
        location_type: 0,
        stop_desc: '',
        stop_url: '',
        zone_id: '',
        stop_timezone: '',
        wheelchair_boarding: 0,
        platform_code: '',
        geometry: {
          type: 'Point',
          coordinates: [-122.6, 45.5]
        },
        census_geographies: [{
          id: 1,
          name: 'Test Geography',
          geoid: 'test-geo-id',
          layer_name: 'test-layer'
        }],
        route_stops: []
      }],
      feedVersions: [{
        id: 'feed-version-1',
        sha1: 'abc123',
        feed: {
          id: 1,
          onestop_id: 'test-feed'
        }
      }],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: true
    }

    // Add some test data to the departure cache
    testData.stopDepartureCache.add(100, '2024-07-03', [
      {
        departure_time: '08:30:00',
        trip: {
          id: 1,
          direction_id: 0,
          route: {
            id: 1
          }
        }
      }
    ])

    // Create complete test fixture
    const testFixture: ScenarioTestFixture = {
      config: testConfig,
      filter: testFilter,
      data: testData
    }

    try {
      // Save complete fixture
      await saveScenarioTestFixtureToFile(testFixture, testFilePath)

      // Load complete fixture
      const loadedFixture = await loadScenarioTestFixtureFromFile(testFilePath)

      // Verify config was preserved including dates
      expect(loadedFixture.config.scheduleEnabled).toBe(true)
      expect(loadedFixture.config.stopLimit).toBe(500)
      expect(loadedFixture.config.geographyIds).toEqual([12345])
      expect(loadedFixture.config.startDate).toEqual(new Date('2024-07-03'))
      expect(loadedFixture.config.endDate).toEqual(new Date('2024-07-10'))
      expect(loadedFixture.config.bbox?.sw.lat).toBe(45.4)

      // Verify filter was preserved including dates and complex settings
      expect(loadedFixture.filter.selectedRouteTypes).toEqual([3, 1])
      expect(loadedFixture.filter.selectedDays).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
      expect(loadedFixture.filter.selectedAgencies).toEqual(['agency-1', 'agency-2'])
      expect(loadedFixture.filter.selectedDayOfWeekMode).toBe('All')
      expect(loadedFixture.filter.selectedTimeOfDayMode).toBe('Peak')
      expect(loadedFixture.filter.frequencyUnder).toBe(30)
      expect(loadedFixture.filter.frequencyOver).toBe(10)
      expect(loadedFixture.filter.frequencyUnderEnabled).toBe(true)
      expect(loadedFixture.filter.frequencyOverEnabled).toBe(false)
      expect(loadedFixture.filter.startTime).toEqual(new Date('2024-07-03T06:00:00'))
      expect(loadedFixture.filter.endTime).toEqual(new Date('2024-07-03T22:00:00'))

      // Verify data was preserved including complex structures
      expect(loadedFixture.data.routes).toHaveLength(1)
      expect(loadedFixture.data.stops).toHaveLength(1)
      expect(loadedFixture.data.routes[0].route_id).toBe('test-route-1')
      expect(loadedFixture.data.stops[0].stop_name).toBe('Test Stop 1')
      expect(loadedFixture.data.isComplete).toBe(true)

      // Verify that stopDepartureCache was properly restored
      expect(loadedFixture.data.stopDepartureCache).toBeInstanceOf(StopDepartureCache)
      const departures = loadedFixture.data.stopDepartureCache.get(100, '2024-07-03')
      expect(departures).toHaveLength(1)
      expect(departures[0].departure_time).toBe('08:30:00')
      expect(departures[0].trip.route.id).toBe(1)
    } finally {
      await cleanup()
    }
  })
})
