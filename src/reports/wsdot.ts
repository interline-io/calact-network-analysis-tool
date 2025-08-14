import { promises as fs } from 'fs'
import { gql } from 'graphql-tag'
import type { ScenarioData, ScenarioConfig, GraphQLClient } from '~/src/scenario'
import { fmtDate } from '~/src/datetime'
import type { Geometry } from '~/src/geom'

export const levelColors: Record<string, string> = {
  level1: '#00ffff',
  level2: '#00ff80',
  level3: '#80ff00',
  level4: '#ffff00',
  level5: '#ff8000',
  level6: '#ff0000',
  levelNights: '#5c5cff',
}

// Service level configuration matching Python implementation
interface ServiceLevelConfig {
  peak?: TimeConfig
  extended?: TimeConfig
  weekend?: TimeConfig
  night_segments?: NightSegmentConfig[]
  total_trips_threshold?: number
  weekend_required: boolean
  level_column: string
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
const SERVICE_LEVELS: Record<string, ServiceLevelConfig> = {
  night: {
    peak: { hours: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4], min_tph: 0, min_total: 4 },
    night_segments: [
      { hours: [23, 0], min_total: 1 },
      { hours: [1, 2], min_total: 1 },
      { hours: [3, 4], min_total: 1 },
      { hours: [2, 3], min_total: 1 }
    ],
    weekend_required: true,
    level_column: 'levelNights'
  },
  level1: {
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 4, min_total: 40 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 3, min_total: 32 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 3, min_total: 32 },
    night_segments: [
      { hours: [23, 0], min_total: 0 },
      { hours: [1, 2], min_total: 0 },
      { hours: [3, 4], min_total: 0 },
      { hours: [2, 3], min_total: 0 }
    ],
    weekend_required: true,
    level_column: 'level1'
  },
  level2: {
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 3, min_total: 32 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 1, min_total: 16 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 1, min_total: 16 },
    weekend_required: true,
    level_column: 'level2'
  },
  level3: {
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 1, min_total: 16 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 0, min_total: 8 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 0, min_total: 8 },
    weekend_required: true,
    level_column: 'level3'
  },
  level4: {
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 0, min_total: 8 },
    weekend_required: false,
    level_column: 'level4'
  },
  level5: {
    total_trips_threshold: 6,
    weekend_required: false,
    level_column: 'level5'
  },
  level6: {
    total_trips_threshold: 2,
    weekend_required: false,
    level_column: 'level6'
  }
}

interface StopFrequencyData {
  stopId: number
  hourlyTrips: Record<number, number> // hour -> trip count
  totalTrips: number
  routeIds: Set<number>
}

interface RouteFrequencyData {
  routeId: number
  directionId: number
  hourlyTrips: Record<number, number>
  totalTrips: number
  stopIds: Set<number>
}

export interface WSDOTReport {
  stops: WSDOTStopResult[]
  totalStops: number
  levelStops: Record<string, Set<number>>
  levelLayers: Record<string, GeographyDataFeature[]>
}

export interface WSDOTStopResult {
  stopId: string
  stopName: string
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

export interface WSDOTReportConfig extends ScenarioConfig {
  weekdayDate: Date
  weekendDate: Date
}

export class WSDOTReportFetcher {
  private config: WSDOTReportConfig
  private scenarioData: ScenarioData
  private client: GraphQLClient

  constructor (
    config: WSDOTReportConfig,
    data: ScenarioData,
    client: GraphQLClient,
  ) {
    this.config = config
    this.scenarioData = data
    this.client = client
  }

  async fetch (): Promise<WSDOTReport> {
    console.log('Starting WSDOT frequency analysis...')

    // Extract frequency data for weekday and weekend
    const weekdayFreq = extractFrequencyData(this.scenarioData, this.config.weekdayDate)
    const weekendFreq = extractFrequencyData(this.scenarioData, this.config.weekendDate)

    console.log(`Analyzed ${weekdayFreq.stops.size} stops and ${weekdayFreq.routes.size} routes for weekday`)
    console.log(`Analyzed ${weekendFreq.stops.size} stops and ${weekendFreq.routes.size} routes for weekend`)

    // Process each service level
    const results: Record<string, Set<number>> = {}
    const levelStops: Record<string, Set<number>> = {}

    for (const [levelName, config] of Object.entries(SERVICE_LEVELS)) {
      const qualifyingStops = processServiceLevel(levelName, config, weekdayFreq, weekendFreq)
      results[levelName] = qualifyingStops
      levelStops[config.level_column] = qualifyingStops
      console.log(`${levelName}: ${qualifyingStops.size} qualifying stops`)
    }

    // Build final result
    const stops: WSDOTStopResult[] = []
    const allStopIds = new Set([...weekdayFreq.stops.keys(), ...weekendFreq.stops.keys()])

    for (const stopId of allStopIds) {
      const stop = this.scenarioData.stops.find(s => s.id === stopId)
      if (!stop?.geometry) continue

      const result: WSDOTStopResult = {
        stopId: stop.stop_id,
        stopName: stop.stop_name || '',
        stopLat: stop.geometry.coordinates[1],
        stopLon: stop.geometry.coordinates[0],
        level6: results.level6?.has(stopId) || false,
        level5: results.level5?.has(stopId) || false,
        level4: results.level4?.has(stopId) || false,
        level3: results.level3?.has(stopId) || false,
        level2: results.level2?.has(stopId) || false,
        level1: results.level1?.has(stopId) || false,
        levelNights: results.night?.has(stopId) || false
      }
      stops.push(result)
    }

    const levelLayers: Record<string, GeographyDataFeature[]> = {}
    const getGeographyLayers = ['county']
    for (const layer of getGeographyLayers) {
      for (const [level, stopIds] of Object.entries(levelStops)) {
        console.log(`Analyzing level ${level} with ${stopIds.size} stops`)
        const data = await getGeographyData(this.client, layer, stopIds)
        levelLayers[level] = data
      }
      levelLayers['any'] = await getGeographyData(this.client, layer, allStopIds)
    }
    return {
      stops,
      totalStops: stops.length,
      levelStops,
      levelLayers
    }
  }
}

function extractFrequencyData (data: ScenarioData, date: Date): { stops: Map<number, StopFrequencyData>, routes: Map<string, RouteFrequencyData> } {
  const stops = new Map<number, StopFrequencyData>()
  const routes = new Map<string, RouteFrequencyData>()
  let depCount = 0

  // Process each stop
  for (const stop of data.stops) {
    const departures = data.stopDepartureCache.get(stop.id, fmtDate(date))

    const stopData: StopFrequencyData = {
      stopId: stop.id,
      hourlyTrips: {},
      totalTrips: departures.length,
      routeIds: new Set()
    }

    // Count trips by hour
    for (const departure of departures) {
      depCount += 1
      const hour = parseHour(departure.departure_time)
      stopData.hourlyTrips[hour] = (stopData.hourlyTrips[hour] || 0) + 1
      stopData.routeIds.add(departure.trip.route.id)

      // Track route frequency
      const routeKey = `${departure.trip.route.id}_${departure.trip.direction_id}`
      if (!routes.has(routeKey)) {
        routes.set(routeKey, {
          routeId: departure.trip.route.id,
          directionId: departure.trip.direction_id,
          hourlyTrips: {},
          totalTrips: 0,
          stopIds: new Set()
        })
      }

      const routeData = routes.get(routeKey)!
      routeData.hourlyTrips[hour] = (routeData.hourlyTrips[hour] || 0) + 1
      routeData.totalTrips += 1
      routeData.stopIds.add(stop.id)
    }

    stops.set(stop.id, stopData)
  }

  // Summary
  const totalHourlyTrips: Map<number, number> = new Map()
  for (const sd of stops.values()) {
    for (const [hour, count] of Object.entries(sd.hourlyTrips)) {
      totalHourlyTrips.set(parseInt(hour), (totalHourlyTrips.get(parseInt(hour)) || 0) + count)
    }
  }
  console.log(`Processed ${stops.size} date ${date} stops with ${depCount} total departures`)
  for (let i = 0; i < 24; i++) {
    console.log(`\thour ${i}: ${totalHourlyTrips.get(i) || 0} trips`)
  }
  return { stops, routes }
}

function parseHour (timeString: string): number {
  const parts = timeString.split(':')
  let hour = parseInt(parts[0], 10)
  // Handle GTFS 24+ hour format
  if (hour >= 24) {
    hour = hour - 24
  }
  return hour
}

function processServiceLevel (
  levelName: string,
  config: ServiceLevelConfig,
  weekdayFreq: { stops: Map<number, StopFrequencyData>, routes: Map<string, RouteFrequencyData> },
  weekendFreq: { stops: Map<number, StopFrequencyData>, routes: Map<string, RouteFrequencyData> }
): Set<number> {
  console.log(`\n====== ${levelName} ======`)
  // Handle total trips threshold levels (level5 and level6)
  if (config.total_trips_threshold !== undefined) {
    return analyzeRouteFrequencyByTotalTrips(weekdayFreq.routes, config.total_trips_threshold)
  }

  // Stop-level analysis
  const stopResults: Set<number>[] = []

  // Peak hours analysis
  if (config.peak) {
    const peakStops = analyzeStopFrequency(weekdayFreq.stops, config.peak)
    stopResults.push(peakStops)
  }

  // Extended hours analysis
  if (config.extended) {
    const extendedStops = analyzeStopFrequency(weekdayFreq.stops, config.extended)
    stopResults.push(extendedStops)
  }

  // Night segments analysis
  if (config.night_segments) {
    const nightStops = processNightSegments(weekdayFreq.stops, config.night_segments)
    stopResults.push(nightStops)
  }

  // Merge stop-level results (intersection)
  let mergedStops = stopResults.length > 0 ? stopResults[0] : new Set<number>()
  for (let i = 1; i < stopResults.length; i++) {
    mergedStops = intersection(mergedStops, stopResults[i])
  }

  // Route-level analysis
  const routeConfig = config.peak || config.extended
  if (routeConfig) {
    const routeStops = analyzeRouteFrequency(weekdayFreq.routes, routeConfig)
    mergedStops = intersection(mergedStops, routeStops)
  }

  // Weekend analysis if required
  if (config.weekend_required && config.weekend) {
    console.log(`Before weekend: ${[...mergedStops].join(', ')}`)
    const weekendStops = analyzeStopFrequency(weekendFreq.stops, config.weekend)
    const weekendRouteStops = analyzeRouteFrequency(weekendFreq.routes, config.weekend)
    const weekendMerged = intersection(weekendStops, weekendRouteStops)
    console.log(`Weekend stops: ${weekendMerged.size} matching stops: ${[...weekendMerged].join(', ')}`)
    console.log(`Weekend route stops: ${weekendRouteStops.size} matching routes: ${[...weekendRouteStops].join(', ')}`)
    console.log(`Weekend merged stops: ${weekendMerged.size} matching stops after intersection: ${[...weekendMerged].join(', ')}`)
    mergedStops = intersection(mergedStops, weekendMerged)
    console.log(`Final merged stops after weekend intersection: ${mergedStops.size}`)
    console.log(`mergedStops after weekend intersection: ${[...mergedStops].join(', ')}`)
  }

  return mergedStops
}

function analyzeStopFrequency (stops: Map<number, StopFrequencyData>, timeConfig: TimeConfig): Set<number> {
  const result = new Set<number>()

  for (const [stopId, stopData] of stops) {
    let totalTrips = 0
    let validHours = 0

    for (const hour of timeConfig.hours) {
      const trips = stopData.hourlyTrips[hour] || 0
      if (trips >= timeConfig.min_tph) {
        validHours++
      }
      totalTrips += trips
    }

    if (validHours === timeConfig.hours.length && totalTrips >= timeConfig.min_total) {
      result.add(stopId)
    }
  }

  return result
}

function analyzeRouteFrequency (routes: Map<string, RouteFrequencyData>, timeConfig: TimeConfig): Set<number> {
  const qualifyingStops = new Set<number>()

  for (const [_, routeData] of routes) {
    let totalTrips = 0
    let validHours = 0

    for (const hour of timeConfig.hours) {
      const trips = routeData.hourlyTrips[hour] || 0
      if (trips >= timeConfig.min_tph) {
        validHours++
      }
      totalTrips += trips
    }

    if (validHours === timeConfig.hours.length && totalTrips >= timeConfig.min_total) {
      // Add all stops on this route
      for (const stopId of routeData.stopIds) {
        qualifyingStops.add(stopId)
      }
    }
  }

  return qualifyingStops
}

function analyzeRouteFrequencyByTotalTrips (routes: Map<string, RouteFrequencyData>, threshold: number): Set<number> {
  const qualifyingStops = new Set<number>()

  for (const [_, routeData] of routes) {
    if (routeData.totalTrips >= threshold) {
      for (const stopId of routeData.stopIds) {
        qualifyingStops.add(stopId)
      }
    }
  }

  return qualifyingStops
}

function processNightSegments (stops: Map<number, StopFrequencyData>, nightSegments: NightSegmentConfig[]): Set<number> {
  const segmentResults: Set<number>[] = []

  for (const segment of nightSegments) {
    const segmentStops = new Set<number>()

    for (const [stopId, stopData] of stops) {
      let totalTrips = 0
      for (const hour of segment.hours) {
        totalTrips += stopData.hourlyTrips[hour] || 0
      }

      if (totalTrips >= segment.min_total) {
        segmentStops.add(stopId)
      }
    }

    segmentResults.push(segmentStops)
  }

  // Return intersection of all segments
  let result = segmentResults[0] || new Set<number>()
  for (let i = 1; i < segmentResults.length; i++) {
    result = intersection(result, segmentResults[i])
  }

  return result
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

export function wsdotReportSave (report: WSDOTReport, filename: string) {
  const data = JSON.stringify(report, null, 2)
  fs.writeFile(filename, data)
}

export async function wsdotReportLoad (filename: string): Promise<WSDOTReport> {
  const data = await fs.readFile(filename, 'utf-8')
  return JSON.parse(data)
}

////////////////
// Fetch geography data for a set of stop IDs
////////////////

interface GeographyDataFeature {
  id: string
  type: string
  properties: {
    dataset_name: string
    layer_name: string
    geoid: string
    name: string
    total_population: number
    intersection_population: number
    [key: string]: any
  }
  geometry: Geometry
}

async function getGeographyData (client: GraphQLClient, layer: string, stopIds: Set<number>): Promise<GeographyDataFeature[]> {
  if (stopIds.size === 0) {
    return []
  }
  console.log('Fetching geography data...', layer, stopIds)
  const variables = {
    geoDatasetName: 'tiger2024',
    tableDatasetName: 'acsdt5y2022',
    tableNames: ['b01001'],
    layer: layer,
    stopBufferRadius: 1000, // 1km buffer
    stopIds: Array.from(stopIds)
  }
  const result = await client.query<{ census_datasets: geographyIntersectionResult[] }>(geographyIntersectionQuery, variables)
  const features: GeographyDataFeature[] = []
  for (const geoDataset of result.data?.census_datasets || []) {
    for (const geography of geoDataset.geographies || []) {
      console.log(`Geography feature: ${geography.name} (layer: ${geography.layer_name} geoid: ${geography.geoid})`)
      const totalArea = geography.geometry_area || 0
      const intersectionArea = geography.intersection_area || 0
      if (!geography.intersection_geometry || totalArea === 0) {
        continue
      }
      const intersectionRatio = Math.min(intersectionArea / totalArea, 1.0)
      const totalPop = geography.values.find(v => v.dataset_name === 'acsdt5y2022')?.values['b01001_001'] || 0
      console.log(`\tPopulation: ${totalPop}`)
      console.log(`\tArea: ${totalArea}`)
      console.log(`\tIntersection area: ${intersectionArea}`)
      console.log(`\tIntersection ratio: ${intersectionRatio}`)
      console.log(`\tIntersection pop: ${totalPop * intersectionRatio}`)
      features.push({
        id: geography.geoid,
        type: 'Feature',
        properties: {
          name: geography.name,
          total_population: totalPop,
          intersection_population: totalPop * intersectionRatio,
          layer_name: geography.layer_name,
          dataset_name: geoDataset.name,
          geoid: geography.geoid,
        },
        geometry: geography.intersection_geometry
      })
    }
  }
  return features
}

interface geographyIntersectionResult {
  id: string
  name: string
  url: string
  geographies: {
    id: number
    name: string
    aland: number
    awater: number
    geoid: string
    layer_name: string
    geometry_area: number
    intersection_area: number
    intersection_geometry: Geometry
    values: {
      dataset_name: string
      geoid: string
      values: Record<string, number>
    }[]
  }[]
}

const geographyIntersectionQuery = gql`
query ($geoDatasetName: String, $layer: String!, $stopIds: [Int!], $tableNames: [String!]!, $tableDatasetName: String, $stopBufferRadius: Float) {
  census_datasets(where: {name: $geoDatasetName}) {
    id
    name
    url
    geographies(where: {layer: $layer, location: {stop_buffer: {stop_ids: $stopIds, radius: $stopBufferRadius}}}) {
      id
      name
      aland
      awater
      geoid
      layer_name
      geometry_area
      intersection_area
      intersection_geometry
      values(dataset: $tableDatasetName, table_names: $tableNames) {
        dataset_name
        geoid
        values
      }
    }
  }
}
`
