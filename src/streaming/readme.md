# Streaming Scenario Implementation

This document outlines the implementation of a streaming scenario architecture that moves heavy data processing from the client to the server while maintaining progressive UI updates.

## Architecture Overview

### Phase-Based Streaming
Instead of continuous streaming, we implemented a discrete phase-based approach:

1. **Stops Phase**: Server processes and sends all stops data at once
2. **Routes Phase**: Server processes and sends all routes and agencies data
3. **Departures Phase**: Server processes and sends all departure data

### Benefits
- **No Data Duplication**: Each piece of data is sent exactly once
- **Clear State Transitions**: UI can show distinct phases of loading
- **Simplified Logic**: Only 4 message types to handle (progress, stops_complete, routes_complete, departures_complete)
- **Progressive Rendering**: Users see stops appear, then routes, then full functionality

## File Structure

### Client-Side Files

#### `src/client/streaming-types.ts`
- Defines all streaming message types
- Simplified departure format for transport (`SimpleDeparture`)
- Direct use of `StopGql`, `RouteGql`, and `AgencyGql` types - no compression

#### `src/client/fetchScenario.ts`
- `StreamingScenarioClient` class for handling streaming requests
- Connection management and error handling
- Direct use of streamed `StopGql` and `RouteGql` objects
- Builds StopDepartureCache from simplified departure data
- Used directly in Vue components with callbacks for reactive updates

### Server-Side Files

#### `server/api/scenario.post.ts`
- Nuxt server route accepting `ScenarioConfig` as POST body
- Streams NDJSON responses with phase-based updates
- Currently includes mock implementation for testing
- TODO: Integrate with existing `ScenarioFetcher`

### Test Implementation

#### `pages/streaming-test.vue`
- Test page demonstrating the streaming functionality
- Shows progress updates, results, and error handling
- Access at `/streaming-test` when running dev server

## Message Protocol

### Progress Messages
```typescript
{
  type: 'progress',
  data: {
    phase: 'stops' | 'routes' | 'departures',
    current: number,
    total: number,
    message: string
  }
}
```

### Phase Completion Messages
```typescript
// Stops complete - sends StopGql objects directly
{
  type: 'stops_complete',
  data: {
    stops: StopGql[],
    feedVersions: any[]
  }
}

// Routes complete - sends RouteGql and AgencyGql objects directly  
{
  type: 'routes_complete',
  data: {
    routes: RouteGql[],
    agencies: AgencyGql[]
  }
}

// Departures complete - uses simplified departure format
{
  type: 'departures_complete',
  data: {
    departures: SimpleDeparture[],
    summary: { totalStops, totalRoutes, totalDepartures }
  }
}
```

## Integration with Existing Code

### Current Status
- ✅ Type definitions and streaming protocol implemented
- ✅ Client-side streaming consumer implemented
- ✅ Server route with mock implementation
- ✅ Test page functional
- ✅ Simplified without compression overhead
- ✅ Direct client usage without composable abstraction

### Next Steps
1. **Integrate with ScenarioFetcher**: Replace mock implementation in `server/api/scenario.post.ts` with actual `ScenarioFetcher` logic
2. **Update tne.vue**: Replace direct `ScenarioFetcher` usage with `StreamingScenarioClient` 
3. **Add feature flag**: Allow switching between old and new implementations
4. **Add caching**: Implement server-side caching using scenario config hash
5. **Error recovery**: Add retry logic and better error handling

### Usage in Components

Replace existing scenario fetching:

```vue
<script setup>
import { ref } from 'vue'
import { StreamingScenarioClient } from '~/src/client/fetchScenario'

// Reactive state
const isLoading = ref(false)
const stops = ref([])
const routes = ref([])
const agencies = ref([])

// Client
const client = new StreamingScenarioClient()

// Fetch scenario with callbacks
const fetchScenario = async () => {
  isLoading.value = true
  
  await client.fetchScenario(scenarioConfig.value, {
    onStopsComplete: (stopsData) => {
      stops.value = stopsData
    },
    onRoutesComplete: (routesData, agenciesData) => {
      routes.value = routesData
      agencies.value = agenciesData
    },
    onDeparturesComplete: () => {
      isLoading.value = false
    }
  })
}
</script>
```

## Simplified Data Transport

Instead of custom compression, we send the actual GraphQL types directly:
- **Stops**: Full `StopGql` objects with all properties
- **Routes**: Full `RouteGql` objects with geometry and agency data  
- **Agencies**: Full `AgencyGql` objects
- **Departures**: Simplified `SimpleDeparture` format (only essential fields)

This reduces implementation complexity while maintaining good performance for most use cases. If payload size becomes an issue later, compression can be added back selectively.

## Testing

1. Start dev server: `npm run dev`
2. Navigate to `/streaming-test`
3. Click "Test Streaming Scenario"
4. Observe progressive loading phases

The test shows:
- Progress updates during each phase
- Stops appearing first
- Routes and agencies appearing second
- Completion status when all data is loaded

## Error Handling

- Network errors with automatic abortion
- Malformed message parsing (continues processing)
- Server-side errors propagated to client
- Connection cancellation support
- Clean state management on errors

This implementation successfully demonstrates the streaming architecture while keeping complexity minimal. The direct client usage pattern makes it easy to integrate into existing Vue components without additional abstraction layers.
