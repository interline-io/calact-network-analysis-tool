// WSDOT service-level configuration tables and the pure classification logic
// that decides which stops/routes meet each level. Extracted from index.ts so
// that file stays focused on fetch/stream orchestration. No I/O here — all
// inputs are the frequency maps built by extractFrequencyData.

import type { StopTimeCacheItem, RouteGql } from '~~/src/tl'

// Service level configuration matching Python implementation
interface ServiceLevelConfig {
  name: string
  description: string
  peak?: TimeConfig
  extended?: TimeConfig
  weekend?: TimeConfig
  any?: TimeConfig
  nightSegments?: NightSegmentConfig[]
  weekendRequired?: boolean
}

interface TimeConfig {
  hours: number[]
  min_tph: number
  min_total: number
}

interface NightSegmentConfig {
  hours: number[]
  min_total: number
}

// WSDOT service levels configuration
export type LevelKey = 'level1' | 'level2' | 'level3' | 'level4' | 'level5' | 'level6' | 'levelNights' | 'levelAll'

const ALL_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
const PEAK_HOURS = [9, 10, 11, 12, 13, 14, 15, 16]
const EXTENDED_HOURS = [6, 7, 8, 17, 18, 19, 20, 21]

export const SERVICE_LEVELS: Record<LevelKey, ServiceLevelConfig> = {
  level1: {
    name: 'Level 1',
    description: 'Level 1',
    peak: { hours: PEAK_HOURS, min_tph: 4, min_total: 40 },
    extended: { hours: EXTENDED_HOURS, min_tph: 3, min_total: 32 },
    weekend: { hours: PEAK_HOURS, min_tph: 3, min_total: 32 },
    nightSegments: [
      { hours: [23, 0], min_total: 0 },
      { hours: [1, 2], min_total: 0 },
      { hours: [3, 4], min_total: 0 },
      { hours: [2, 3], min_total: 0 }
    ],
  },
  level2: {
    name: 'Level 2',
    description: 'Level 2',
    peak: { hours: PEAK_HOURS, min_tph: 3, min_total: 32 },
    extended: { hours: EXTENDED_HOURS, min_tph: 1, min_total: 16 },
    weekend: { hours: PEAK_HOURS, min_tph: 1, min_total: 16 },
  },
  level3: {
    name: 'Level 3',
    description: 'Level 3',
    peak: { hours: PEAK_HOURS, min_tph: 1, min_total: 16 },
    extended: { hours: EXTENDED_HOURS, min_tph: 0, min_total: 8 },
    weekend: { hours: PEAK_HOURS, min_tph: 0, min_total: 8 },
  },
  level4: {
    name: 'Level 4',
    description: 'Level 4',
    peak: { hours: PEAK_HOURS, min_tph: 0, min_total: 8 },
  },
  level5: {
    name: 'Level 5',
    description: 'Level 5',
    any: { hours: ALL_HOURS, min_tph: 0, min_total: 6 },
  },
  level6: {
    name: 'Level 6',
    description: 'Level 6',
    any: { hours: ALL_HOURS, min_tph: 0, min_total: 2 },
  },
  levelNights: {
    name: 'Night',
    description: 'Night service',
    peak: { hours: ALL_HOURS, min_tph: 0, min_total: 4 },
    nightSegments: [
      { hours: [23, 0], min_total: 1 },
      { hours: [1, 2], min_total: 1 },
      { hours: [3, 4], min_total: 1 },
      { hours: [2, 3], min_total: 1 }
    ],
  },
  levelAll: {
    name: 'All stops',
    description: 'All stops in the scenario',
    any: { hours: ALL_HOURS, min_tph: 0, min_total: 0 },
  },
}

export const levelColors: Record<LevelKey, string> = {
  level1: '#00ffff',
  level2: '#00ff80',
  level3: '#80ff00',
  level4: '#ffff00',
  level5: '#ff8000',
  level6: '#ff0000',
  levelNights: '#5c5cff',
  levelAll: '#000000',
}

export interface StopFrequencyData {
  stopId: number
  gtfsStopId: string
  hourlyDepartures: Map<number, StopTimeCacheItem[]>
  routeIds: Set<number>
}

export interface RouteFrequencyData {
  routeId: number
  route: RouteGql
  hourlyDepartures: Map<number, StopTimeCacheItem[]>
  stopIds: Set<number>
}

export function processServiceLevel (
  config: ServiceLevelConfig,
  weekdayFreq: { stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData> },
  weekendFreq: { stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData> },
  routeHourCompatMode?: boolean
): Set<number> {
  const stopIdMap = new Map<number, string>()
  for (const stopData of weekdayFreq.stops.values()) {
    stopIdMap.set(stopData.stopId, stopData.gtfsStopId)
  }
  for (const stopData of weekendFreq.stops.values()) {
    stopIdMap.set(stopData.stopId, stopData.gtfsStopId)
  }
  const printStopIds = (stopSet: Set<number>): string => {
    return JSON.stringify(Array.from(stopSet.values()).map(s => stopIdMap.get(s)).sort())
  }

  // Stop-level analysis
  const stopResults: Set<number>[] = []

  // Peak hours analysis
  if (config.peak) {
    const peakStops = analyzeFrequency(weekdayFreq.stops, weekdayFreq.routes, config.peak)
    console.log(`Stops meeting peak criteria: ${peakStops.size}`)
    stopResults.push(peakStops)
  }

  // Extended hours analysis
  if (config.extended) {
    const extendedStops = analyzeFrequency(weekdayFreq.stops, weekdayFreq.routes, config.extended)
    console.log(`Stops meeting extended criteria: ${extendedStops.size}`)
    stopResults.push(extendedStops)
  }

  // Night segments analysis
  if (config.nightSegments) {
    const nightStops = processNightSegments(weekdayFreq.stops, config.nightSegments)
    console.log(`Stops meeting night criteria: ${nightStops.size}`)
    stopResults.push(nightStops)
  }

  // Handle total trips threshold levels (level5 and level6)
  if (config.any) {
    const { matchedStops: totalTripStops } = analyzeRouteFrequency(weekdayFreq.stops, weekdayFreq.routes, config.any, routeHourCompatMode)
    console.log(`Stops meeting total trips criteria: ${totalTripStops.size}`)
    stopResults.push(totalTripStops)
  }

  // Route level analysis
  if (config.peak) {
    const { matchedStops: peakRouteStops } = analyzeRouteFrequency(weekdayFreq.stops, weekdayFreq.routes, config.peak, routeHourCompatMode)
    console.log(`Stops on routes meeting peak criteria: ${peakRouteStops.size}`)
    stopResults.push(peakRouteStops)
  }
  if (config.extended) {
    const { matchedStops: extendedRouteStops } = analyzeRouteFrequency(weekdayFreq.stops, weekdayFreq.routes, config.extended, routeHourCompatMode)
    console.log(`Stops on routes meeting extended criteria: ${extendedRouteStops.size}`)
    stopResults.push(extendedRouteStops)
  }

  // Weekend analysis
  if (config.weekend) {
    const weekendStops = analyzeFrequency(weekendFreq.stops, weekendFreq.routes, config.weekend)
    console.log(`Stops meeting weekend hour criteria: ${weekendStops.size}`)
    stopResults.push(weekendStops)

    const { matchedStops: weekendRouteStops } = analyzeRouteFrequency(weekendFreq.stops, weekendFreq.routes, config.weekend, routeHourCompatMode)
    console.log(`Stops on routes meeting weekend criteria: ${weekendRouteStops.size}`)
    stopResults.push(weekendRouteStops)
  }

  // Merge stop-level results (intersection)
  const mergedStops = mergeSets(stopResults)

  console.log(`Total qualifying stops for service level: ${mergedStops.size}`)
  console.log(printStopIds(mergedStops))
  return mergedStops
}

function mergeSets (stopResults: Set<number>[]): Set<number> {
  let mergedStops: Set<number> = stopResults.length > 0 ? (stopResults[0] ?? new Set<number>()) : new Set<number>()
  for (let i = 1; i < stopResults.length; i++) {
    const nextSet = stopResults[i] ?? new Set<number>()
    mergedStops = intersection(mergedStops, nextSet)
  }
  return mergedStops
}

function analyzeFrequency (stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData>, timeConfig: TimeConfig): Set<number> {
  const qualifyingStops = new Set<number>()
  for (const [stopId, stopData] of stops) {
    let totalTrips = 0
    let meetsTph = true
    for (const hour of timeConfig.hours) {
      const departureCount = (stopData.hourlyDepartures.get(hour) || []).length
      if (departureCount < timeConfig.min_tph) {
        meetsTph = false
      }
      totalTrips += departureCount
    }
    if (!meetsTph) {
      continue
    }
    if (totalTrips < timeConfig.min_total) {
      continue
    }
    qualifyingStops.add(stopId)
  }
  return qualifyingStops
}

function analyzeRouteFrequency (stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData>, timeConfig: TimeConfig, routeHourCompatMode?: boolean): { matchedStops: Set<number>, matchedRoutes: Set<string> } {
  // Calculate all route-direction combinations that satisfy timeConfig
  // This matches the Python implementation: get_tph_by_line -> pivot_table by route_id,direction_id
  const qualifyingRouteStops = new Set<number>()
  const qualifyingRoutes = new Set<string>()

  // Use route trips per hour per direction
  for (const routeData of routes.values()) {
    // console.log('\n===== Route', routeData.route.route_id)
    const allTrips = new Set<number>()

    for (const directionId of [0, 1]) {
      // console.log('Direction', directionId)

      // Bucket route-direction trips into hours
      const dirHourTrips: Map<number, Set<number>> = new Map()
      const dirAllTrips = new Set<number>()
      for (const hour of ALL_HOURS) {
        const deps = routeData.hourlyDepartures.get(hour) || []
        const hourTrips = new Set<number>()
        for (const dep of deps.filter(d => d.directionId === directionId)) {
          // ... to match python version, only use the first hour for each trip
          if (!allTrips.has(dep.tripId)) {
            hourTrips.add(dep.tripId)
            allTrips.add(dep.tripId)
          }
        }
        dirHourTrips.set(hour, hourTrips)
      }

      // Check if this route-direction meets the frequency requirements
      let dirTphMatches = true
      for (const hour of timeConfig.hours) {
        const hourTrips = dirHourTrips.get(hour) || new Set<number>()
        for (const tripId of hourTrips) {
          dirAllTrips.add(tripId)
        }
        // console.log('\thour', hour, 'trips:', hourTrips.size, 'trip_ids:', Array.from(hourTrips).join(' '))
      }

      // FIXME: Feature flag to match Python implementation quirk
      // In compat mode, only the last hour in the list is checked for tph
      // This matches the Python implementation, but seems like a bug
      // e.g. for peak hours, only the 16:00 hour is checked for tph
      // Outside of compat mode, all hours are checked for tph
      const routeHours = routeHourCompatMode ? timeConfig.hours.slice(-1) : timeConfig.hours
      for (const hour of routeHours) {
        const hourTrips = dirHourTrips.get(hour) || new Set<number>()
        if (hourTrips.size < timeConfig.min_tph) {
          // console.log(`\t\thour ${hour} does not meet tph requirement (${hourTrips.size} < ${timeConfig.min_tph})`)
          dirTphMatches = false
        }
      }

      if (!dirTphMatches) {
        // console.log('Does not meet tph requirement')
        continue
      }
      if (dirAllTrips.size < timeConfig.min_total) {
        // console.log(`\t\tdirection does not meet total trip requirement (${dirAllTrips.size} < ${timeConfig.min_total})`)
        continue
      }

      // Add all stops served by this qualifying route-direction
      // console.log('QUALIFIES')
      qualifyingRoutes.add(routeData.route.route_id)
      for (const stopId of routeData.stopIds) {
        qualifyingRouteStops.add(stopId)
      }
    }

    // console.log('all scheduled trips:', allTrips.size)
    // console.log('\n\t', Array.from(allTrips).join(' '))
  }
  // console.log(`Stops on qualifying routes: ${qualifyingRouteStops.size}`)
  // console.log(JSON.stringify(Array.from(qualifyingRoutes).sort()))
  // console.log(`Qualifying routes: ${qualifyingRoutes.size}`)
  return { matchedStops: qualifyingRouteStops, matchedRoutes: qualifyingRoutes }
}

function processNightSegments (stops: Map<number, StopFrequencyData>, nightSegments: NightSegmentConfig[]): Set<number> {
  const segmentResults: Set<number>[] = []
  for (const segment of nightSegments) {
    const segmentStops = new Set<number>()
    for (const [stopId, stopData] of stops) {
      let totalDepartures = 0
      for (const hour of segment.hours) {
        totalDepartures += (stopData.hourlyDepartures.get(hour) || []).length
      }
      if (totalDepartures >= segment.min_total) {
        segmentStops.add(stopId)
      }
    }
    segmentResults.push(segmentStops)
  }
  // Return intersection of all segments
  return mergeSets(segmentResults)
}

function intersection<T> (set1: Set<T>, set2: Set<T>): Set<T> {
  const result = new Set<T>()
  for (const item of set1) {
    if (set2.has(item)) {
      result.add(item)
    }
  }
  return result
}
