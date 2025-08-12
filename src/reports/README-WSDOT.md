# WSDOT Frequent Transit Service Analysis

## Overview

This module implements the WSDOT (Washington State Department of Transportation) Frequent Transit Service Study analysis in TypeScript, porting the original Python implementation to work with the ScenarioData structure.

## Purpose

The analysis classifies transit stops into different service levels based on trips per hour (TPH) thresholds across various time periods. This supports the WSDOT Frequent Transit Service Study: https://engage.wsdot.wa.gov/frequent-transit-service-study/

## Service Levels

The analysis defines 7 service levels with increasingly strict requirements:

### Level 6 (Basic Service)
- **Threshold**: Routes with ≥2 total trips
- **Analysis**: Route-level total trips
- **Weekend Required**: No

### Level 5 (Low Frequency)
- **Threshold**: Routes with ≥6 total trips  
- **Analysis**: Route-level total trips
- **Weekend Required**: No

### Level 4 (Limited Frequent Service)
- **Peak Hours** (9am-4pm): ≥0 TPH, ≥8 total trips
- **Analysis**: Stop and route-level during peak hours
- **Weekend Required**: No

### Level 3 (Moderate Frequent Service)
- **Peak Hours** (9am-4pm): ≥1 TPH, ≥16 total trips
- **Extended Hours** (6-8am, 5-9pm): ≥0 TPH, ≥8 total trips
- **Weekend**: ≥0 TPH, ≥8 total trips during peak hours
- **Analysis**: Stop and route-level across all time periods
- **Weekend Required**: Yes

### Level 2 (High Frequent Service)
- **Peak Hours** (9am-4pm): ≥3 TPH, ≥32 total trips
- **Extended Hours** (6-8am, 5-9pm): ≥1 TPH, ≥16 total trips
- **Weekend**: ≥1 TPH, ≥16 total trips during peak hours
- **Analysis**: Stop and route-level across all time periods
- **Weekend Required**: Yes

### Level 1 (Very High Frequent Service)
- **Peak Hours** (9am-4pm): ≥4 TPH, ≥40 total trips
- **Extended Hours** (6-8am, 5-9pm): ≥3 TPH, ≥32 total trips
- **Weekend**: ≥3 TPH, ≥32 total trips during peak hours
- **Night Segments**: ≥0 TPH across 4 night time segments
- **Analysis**: Stop and route-level across all time periods
- **Weekend Required**: Yes

### Night Service (24-Hour Service)
- **All Day** (5am-4am): ≥0 TPH, ≥4 total trips
- **Night Segments**: ≥1 trip in each of 4 night segments:
  - 11pm-1am
  - 1am-3am  
  - 3am-5am
  - 2am-3am (overlap check)
- **Analysis**: Stop and route-level across all time periods
- **Weekend Required**: Yes

## Methodology

The analysis uses a two-pronged approach for comprehensive coverage:

### 1. Stop-Level Analysis
- Filters individual stops based on minimum TPH requirements during specific time windows
- Counts departures by hour from the stop departure cache
- Applies intersection logic across different time periods

### 2. Route-Level Analysis  
- Identifies routes meeting frequency thresholds by direction
- Aggregates trip frequencies by route and direction
- Includes all stops on qualifying routes

### 3. Intersection Logic
Results from different time periods and analysis methods are merged using intersection (AND) logic, meaning stops must meet ALL criteria for their assigned level.

### 4. Weekend Analysis
For applicable levels, the analysis is repeated on weekend service data and stops must qualify on both weekdays and weekends.

## Usage

```typescript
import { wsdotReport } from '~/src/reports/wsdot'
import type { ScenarioData } from '~/src/scenario'

// After fetching scenario data with departure schedules
const result = wsdotReport(scenarioData, '2025-08-11', '2025-08-17')

// Result contains:
// - stops: Array of stops with service level classifications
// - totalStops: Total number of analyzed stops  
// - levelCounts: Count of stops qualifying for each level
```

## Output Format

```typescript
interface WSDOTReport {
  stops: WSDOTStopResult[]
  totalStops: number
  levelCounts: Record<string, number>
}

interface WSDOTStopResult {
  stopId: number
  stopLat: number
  stopLon: number
  level6: boolean
  level5: boolean  
  level4: boolean
  level3: boolean
  level2: boolean
  level1: boolean
  levelNights: boolean
}
```

## Implementation Details

- **Time Parsing**: Handles GTFS 24+ hour format (e.g., 25:30:00 becomes 1:30 AM)
- **Route Tracking**: Groups departures by route and direction for route-level analysis
- **Memory Efficient**: Uses Set operations for intersection logic
- **Type Safe**: Full TypeScript type definitions with proper interfaces

## Testing

The implementation includes comprehensive tests using real transit data from Portland, OR. The test verifies:
- Correct classification across all service levels
- Proper handling of geographic coordinates
- Expected hierarchical results (higher levels have fewer qualifying stops)

## Differences from Python Implementation

- Uses ScenarioData structure instead of transit_service_analyst
- Leverages TypeScript type safety and modern ES6+ features
- Integrated with existing departure cache system
- Simplified intersection logic using native Set operations
