# ScenarioFetcher - Transit Data Fetching Library

The `ScenarioFetcher` is a standalone TypeScript library extracted from the Vue.js component to enable fetching and processing transit data independent of the frontend framework. This allows for reuse in CLI tools, testing, and other non-Vue contexts.

## Overview

The ScenarioFetcher handles:

- **Stop fetching**: Retrieves transit stops based on geographic bounds or geography IDs
- **Route fetching**: Fetches routes associated with the stops  
- **Schedule fetching**: Downloads departure times for stops across date ranges
- **Data filtering**: Applies filters for route types, agencies, frequencies, and time windows
- **Progress tracking**: Provides callbacks for monitoring fetch progress

## Architecture

### Core Classes

- **`ScenarioFetcher`**: Main orchestrator that coordinates data fetching
- **`GraphQLClient`**: Abstract base class for GraphQL query execution
- **`ScenarioConfig`**: Configuration interface for fetch parameters
- **`ScenarioResult`**: Result interface containing filtered stops, routes, and agencies

### Key Features

- **Framework Independent**: No Vue.js dependencies
- **Testable**: Easy to mock and unit test
- **Configurable**: Flexible configuration for different use cases
- **Async/Promise-based**: Modern async/await patterns
- **Error Handling**: Comprehensive error handling with callbacks

## Usage

### Basic Usage

```typescript
import { ScenarioFetcher, GraphQLClient, type ScenarioConfig } from './scenario-fetcher'

// Implement GraphQL client
class MyGraphQLClient extends GraphQLClient {
  async query<T>(query: any, variables?: any): Promise<{ data?: T }> {
    // Your GraphQL implementation here
    return fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    }).then(r => r.json())
  }
}

// Configure scenario
const config: ScenarioConfig = {
  bbox: {
    sw: { lat: 45.4, lon: -122.8 },
    ne: { lat: 45.7, lon: -122.5 },
    valid: true
  },
  scheduleEnabled: true,
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-07'),
  selectedRouteTypes: [3], // Bus
  selectedDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  selectedAgencies: [],
  selectedDayOfWeekMode: 'Any',
  selectedTimeOfDayMode: 'All',
  frequencyUnderEnabled: false,
  frequencyOverEnabled: false,
}

// Create and run fetcher
const client = new MyGraphQLClient()
const fetcher = new ScenarioFetcher(config, client, {
  onProgress: (progress) => console.log('Progress:', progress),
  onComplete: (result) => console.log('Complete:', result),
  onError: (error) => console.error('Error:', error)
})

const result = await fetcher.fetch()
```

### CLI Usage

```bash
# Basic usage with bounding box (requires API key)
export TRANSITLAND_API_KEY="your_api_key_here"
npm run cli-example -- --bbox "-122.8,45.4,-122.5,45.7" --start-date "2024-01-01"

# Or provide API key directly
npm run cli-example -- --api-key "your_api_key" --bbox "-122.8,45.4,-122.5,45.7" --start-date "2024-01-01"

# Advanced usage with filters
npm run cli-example -- \
  --bbox "-122.8,45.4,-122.5,45.7" \
  --start-date "2024-01-01" \
  --end-date "2024-01-07" \
  --route-types "3,1" \
  --days "monday,wednesday,friday" \
  --output json
```

**Note**: The Transitland API requires authentication. Get your API key from [https://www.transit.land/](https://www.transit.land/).

### Testing

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ScenarioFetcher } from '../src/scenario-fetcher'

describe('ScenarioFetcher', () => {
  it('should fetch scenario data', async () => {
    const mockClient = new MockGraphQLClient()
    mockClient.mockQuery.mockResolvedValue({ data: { stops: [] } })
    
    const fetcher = new ScenarioFetcher(config, mockClient)
    const result = await fetcher.fetch()
    
    expect(result.stops).toHaveLength(0)
  })
})
```

## Configuration Options

### ScenarioConfig Interface

```typescript
interface ScenarioConfig {
  // Geographic bounds
  bbox?: Bbox                          // Bounding box for spatial filtering
  geographyIds?: number[]              // Alternative to bbox - specific geography IDs

  // Time filtering  
  startDate?: Date                     // Start date for schedule queries
  endDate?: Date                       // End date for schedule queries
  startTime?: Date                     // Start time of day filter
  endTime?: Date                       // End time of day filter
  selectedDays: dow[]                  // Days of week to include

  // Service filtering
  scheduleEnabled: boolean             // Whether to fetch schedule data
  selectedRouteTypes: number[]         // GTFS route types (0=tram, 1=subway, 3=bus, etc.)
  selectedAgencies: string[]           // Agency names to filter by
  selectedDayOfWeekMode: string        // 'Any' or 'All' - how to match days
  selectedTimeOfDayMode: string        // 'All' or 'Partial' - time matching mode

  // Frequency filtering
  frequencyUnder?: number              // Maximum headway in minutes
  frequencyOver?: number               // Minimum headway in minutes  
  frequencyUnderEnabled: boolean       // Enable upper frequency filter
  frequencyOverEnabled: boolean        // Enable lower frequency filter
}
```

### Result Structure

```typescript
interface ScenarioResult {
  stops: Stop[]                        // Filtered stop data with visit statistics
  routes: Route[]                      // Filtered route data with frequency calculations
  agencies: Agency[]                   // Agency summaries
  stopDepartureCache: StopDepartureCache // Raw departure time cache
  isComplete: boolean                  // Whether all async operations completed
}
```

## Implementation Notes

### Data Flow

1. **Stop Fetching**: Query stops by bbox/geography → extract route IDs
2. **Route Fetching**: Query routes by collected IDs  
3. **Schedule Fetching**: Query departures for stops across date range
4. **Filtering**: Apply all configured filters to stops/routes/agencies
5. **Result**: Return filtered, enriched data

### Performance Considerations

- **Pagination**: Stops are fetched in batches of 100
- **Concurrency**: Stop departure queries use configurable batch sizes
- **Caching**: Departure times cached by stop/date for efficient filtering
- **Query Limits**: Built-in query count tracking and limits

### Error Handling

- GraphQL errors are caught and propagated via callbacks
- Network errors bubble up as Promise rejections
- Query limit exceeded throws specific error
- Incomplete data is marked in result.isComplete

## Migration from Vue Component

If migrating existing Vue component code:

1. **Extract Configuration**: Move reactive refs to ScenarioConfig object
2. **Replace Watchers**: Use callbacks for progress/completion events  
3. **Remove Vue APIs**: Replace useLazyQuery with GraphQLClient implementation
4. **Update Tests**: Use vitest/jest instead of Vue Test Utils

## Examples

See the included files for complete examples:
- `docs/examples/cli-example.ts` - Command line interface and usage patterns
- `tests/scenario-fetcher.test.ts` - Unit test examples

For detailed usage instructions and options, see the [examples README](examples/README.md).
