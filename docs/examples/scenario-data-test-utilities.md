# Scenario Fixtures

This document describes how to use the scenario fixtures utilities for saving and loading complete test scenarios including `ScenarioConfig`, `ScenarioFilter`, and `ScenarioData` to and from JSON files.

**Note**: These utilities are located in `src/scenario-fixtures.ts` for better organization and separation of concerns.

## Overview

The scenario fixtures provide functions to serialize and deserialize complete test scenarios that include:
- `ScenarioConfig` objects (bbox, dates, settings)
- `ScenarioFilter` objects (time ranges, selected options)
- `ScenarioData` objects (routes, stops, departures, etc.)

This includes handling complex structures like `StopDepartureCache` with nested Map objects and Date objects that don't serialize to JSON naturally.

## Available Functions

- `saveScenarioTestFixtureToFile(fixture, filePath)` - Save complete fixture to a specific file path
- `loadScenarioTestFixtureFromFile(filePath)` - Load complete fixture from a specific file path

## Usage Examples

### Basic Usage

```typescript
import { saveScenarioTestFixtureToFile, loadScenarioTestFixtureFromFile } from './scenario-fixtures'
import type { ScenarioTestFixture } from './scenario-fixtures'

// Create complete test fixture with config, filter, and data
const fixture: ScenarioTestFixture = {
  config: {
    bbox: myBbox,
    scheduleEnabled: true,
    startDate: new Date('2024-07-03'),
    endDate: new Date('2024-07-10'),
    geographyIds: [12345],
    stopLimit: 1000
  },
  filter: {
    startTime: new Date('2024-07-03T06:00:00'),
    endTime: new Date('2024-07-03T22:00:00'),
    selectedRouteTypes: [3, 1], // Bus and Metro
    selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    selectedAgencies: ['trimet'],
    selectedDayOfWeekMode: 'All',
    selectedTimeOfDayMode: 'Peak',
    frequencyUnderEnabled: true,
    frequencyOverEnabled: false
  },
  data: scenarioData // Your fetched ScenarioData
}

// Save complete fixture
await saveScenarioTestFixtureToFile(fixture, '/path/to/portland-weekday-rush-hour.json')

// Load complete fixture
const { config, filter, data } = await loadScenarioTestFixtureFromFile('/path/to/portland-weekday-rush-hour.json')
```

### In Test Files

```typescript
import { describe, it, expect } from 'vitest'
import { loadScenarioTestFixtureFromFile } from './scenario-fixtures'
import { applyScenarioResultFilter } from './scenario'

describe('Transit Analysis Tests', () => {
  it('should filter routes correctly', async () => {
    // Load complete test fixture with config, filter, and data
    const { config, filter, data } = await loadScenarioTestFixtureFromFile('/path/to/sample-transit-data.json')
    
    // Apply filters and test results
    const filtered = applyScenarioResultFilter(data, config, filter)
    
    expect(filtered.routes.length).toBeGreaterThan(0)
    expect(filtered.stops.length).toBeGreaterThan(0)
  })

  it('should test with different time periods', async () => {
    // Load fixture and modify filter for different test
    const fixture = await loadScenarioTestFixtureFromFile('/path/to/base-scenario.json')
    
    // Test morning rush hour
    fixture.filter.startTime = new Date('2024-07-03T07:00:00')
    fixture.filter.endTime = new Date('2024-07-03T09:00:00')
    
    const morningResults = applyScenarioResultFilter(fixture.data, fixture.config, fixture.filter)
    expect(morningResults.routes.length).toBeGreaterThan(0)
  })
})
```

### For Component Testing

```typescript
// In your component tests
import { loadScenarioTestFixtureFromFile } from '@/src/scenario-fixtures'

describe('TransitMapComponent', () => {
  it('should render with test data', async () => {
    const { config, filter, data } = await loadScenarioTestFixtureFromFile('/path/to/test-scenario-component-data.json')

    const wrapper = mount(TransitMapComponent, {
      props: {
        scenarioData: data,
        config: config,
        filter: filter
      }
    })

    expect(wrapper.find('.transit-route').exists()).toBe(true)
  })
})
```

## Creating Test Data

To create reusable test fixtures:

```typescript
// One-time setup to create comprehensive test fixtures
const config: ScenarioConfig = { /* your config */ }
const filter: ScenarioFilter = { /* your filter */ }
const fetcher = new ScenarioFetcher(config, realClient)
const data = await fetcher.fetch()

// Save complete fixture with all context
const fixture: ScenarioTestFixture = { config, filter, data }
await saveScenarioTestFixtureToFile(fixture, '/path/to/portland-downtown-complete.json')

// Create variations by modifying filter
const busOnlyFilter = { ...filter, selectedRouteTypes: [3] }
const busOnlyFixture = { config, filter: busOnlyFilter, data }
await saveScenarioTestFixtureToFile(busOnlyFixture, '/path/to/portland-downtown-bus-only.json')

const peakHoursFilter = { 
  ...filter, 
  startTime: new Date('2024-07-03T07:00:00'),
  endTime: new Date('2024-07-03T09:00:00')
}
const peakHoursFixture = { config, filter: peakHoursFilter, data }
await saveScenarioTestFixtureToFile(peakHoursFixture, '/path/to/portland-downtown-peak-hours.json')
```

## What Gets Serialized

The utility handles serialization of complete test fixtures including:

### ScenarioConfig  
- ✅ Bbox coordinates and settings
- ✅ Date objects (startDate, endDate) → ISO strings
- ✅ Geography IDs and stop limits
- ✅ Boolean flags and numeric settings

### ScenarioFilter
- ✅ Date objects (startTime, endTime) → ISO strings  
- ✅ Selected route types, days, agencies
- ✅ Frequency settings and enabled flags
- ✅ Day-of-week and time-of-day modes

### ScenarioData
- ✅ Routes and stops with all their properties
- ✅ Feed versions  
- ✅ StopDepartureCache including nested Maps
- ✅ All route cache data (both directions)
- ✅ Complex nested objects and arrays

### Date Handling
All Date objects are automatically converted to ISO strings during serialization and restored as Date objects during deserialization, ensuring perfect round-trip accuracy.

## File Storage

Test fixtures can be stored anywhere you specify with the full file path:
```
/path/to/your/fixtures/
├── portland-downtown-complete.json      # Complete fixture (config + filter + data)
├── seattle-bus-only.json                # Bus-only variation
├── peak-hours-scenario.json             # Peak hours variation
└── ...
```

### Complete Fixture File Structure
```json
{
  "config": {
    "bbox": { "sw": {...}, "ne": {...} },
    "scheduleEnabled": true,
    "startDate": "2024-07-03T00:00:00.000Z",
    "endDate": "2024-07-10T00:00:00.000Z",
    "geographyIds": [12345],
    "stopLimit": 1000
  },
  "filter": {
    "startTime": "2024-07-03T06:00:00.000Z",
    "endTime": "2024-07-03T22:00:00.000Z",
    "selectedRouteTypes": [3, 1],
    "selectedDays": ["monday", "tuesday", ...],
    "selectedAgencies": ["trimet"],
    "selectedDayOfWeekMode": "All",
    "selectedTimeOfDayMode": "Peak",
    "frequencyUnderEnabled": true,
    "frequencyOverEnabled": false
  },
  "data": {
    "routes": [...],
    "stops": [...],
    "feedVersions": [...],
    "stopDepartureCache": {...},
    "isComplete": true
  }
}
```

## Benefits

- **Complete context**: Save config and filter settings along with data
- **Date handling**: Automatic serialization/deserialization of Date objects
- **Faster tests**: No need to fetch real data every time
- **Consistent test data**: Same input for reproducible tests  
- **Offline testing**: Tests work without internet connection
- **Complex scenarios**: Save edge cases and specific configurations
- **Component isolation**: Test UI components with known data states
- **Filter variations**: Create multiple test scenarios from same data
- **Debugging**: Save complete snapshots including all settings used
