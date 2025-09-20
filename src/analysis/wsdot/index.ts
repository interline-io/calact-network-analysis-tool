import { gql } from 'graphql-tag'
import { multiplexStream, requestStream, fmtDate, type GraphQLClient, type Geometry, type Bbox, convertBbox } from '~/src/core'
import { type ScenarioData, type ScenarioConfig, ScenarioStreamSender, ScenarioFetcher, ScenarioDataReceiver, ScenarioStreamReceiver } from '~/src/scenario'
import type { RouteGql, StopTime } from '~/src/tl'

// Service level configuration matching Python implementation
interface ServiceLevelConfig {
  name: string
  description: string
  peak?: TimeConfig
  extended?: TimeConfig
  weekend?: TimeConfig
  any?: TimeConfig
  nightSegments?: NightSegmentConfig[]
  includeAll?: boolean
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

export const SERVICE_LEVELS: Record<LevelKey, ServiceLevelConfig> = {
  level1: {
    name: 'Level 1',
    description: 'Level 1',
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 4, min_total: 40 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 3, min_total: 32 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 3, min_total: 32 },
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
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 3, min_total: 32 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 1, min_total: 16 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 1, min_total: 16 },
  },
  level3: {
    name: 'Level 3',
    description: 'Level 3',
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 1, min_total: 16 },
    extended: { hours: [6, 7, 8, 17, 18, 19, 20, 21], min_tph: 0, min_total: 8 },
    weekend: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 0, min_total: 8 },
  },
  level4: {
    name: 'Level 4',
    description: 'Level 4',
    peak: { hours: [9, 10, 11, 12, 13, 14, 15, 16], min_tph: 0, min_total: 8 },
  },
  level5: {
    name: 'Level 5',
    description: 'Level 5',
    any: { hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], min_tph: 0, min_total: 6 },
  },
  level6: {
    name: 'Level 6',
    description: 'Level 6',
    any: { hours: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], min_tph: 0, min_total: 2 },
  },
  levelNights: {
    name: 'Night',
    description: 'Night service',
    peak: { hours: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4], min_tph: 0, min_total: 4 },
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
    includeAll: true,
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

interface StopFrequencyData {
  stopId: number
  hourlyDepartures: Map<number, StopTime[]>
  routeIds: Set<number>
}

interface RouteFrequencyData {
  routeId: number
  route: RouteGql
  hourlyDepartures: Map<number, Map<number, StopTime[]>>
  hourlyMaxTph: Map<number, number>
  stopIds: Set<number>
}

export interface WSDOTReport {
  stops: WSDOTStopResult[]
  levelStops: Record<string, number[]>
  levelLayers: Record<string, Record<string, GeographyDataFeature[]>>
  bboxIntersection: GeographyDataFeature[]
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
  levelAll: boolean
}

export interface WSDOTReportConfig extends ScenarioConfig {
  weekdayDate: Date
  weekendDate: Date
  stopBufferRadius?: number
}

export async function runAnalysis (controller: ReadableStreamDefaultController, config: WSDOTReportConfig, client: GraphQLClient): Promise<{ scenarioData: ScenarioData, wsdotResult: WSDOTReport }> {
  // Create a multiplex stream that writes to both the response and a new output stream
  const { inputStream, outputStream } = multiplexStream(requestStream(controller))
  const writer = inputStream.getWriter()

  // Configure fetcher/sender
  const scenarioDataSender = new ScenarioStreamSender(writer)
  const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

  // Configure client/receiver
  const receiver = new ScenarioDataReceiver()
  const scenarioDataClient = new ScenarioStreamReceiver()
  const scenarioClientProgress = scenarioDataClient.processStream(outputStream, receiver)

  // Start the fetch process
  await fetcher.fetch()

  // Run wsdot analysis
  const scenarioData = receiver.getCurrentData()

  // Update the client with the wsdot result
  scenarioDataSender.onProgress({
    isLoading: true,
    currentStage: 'extra',
    currentStageMessage: 'Running WSDOT frequency analysis...'
  })

  let wsdotResult: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }
  try {
    const wsdotFetcher = new WSDOTReportFetcher(config, scenarioData, client)
    wsdotResult = await wsdotFetcher.fetch()
    // Update the client with the wsdot result
    scenarioDataSender.onProgress({
      isLoading: true,
      currentStage: 'extra',
      extraData: wsdotResult,
      currentStageMessage: 'Running WSDOT frequency analysis...'
    })
  } catch (e) {
    console.error('WSDOT analysis error:', e)
    scenarioDataSender.onError({ message: `WSDOT analysis error: ${e}` })
  }

  // Complete the scenario data stream
  scenarioDataSender.onComplete()

  // Final complete - close the multiplexed stream
  writer.close()

  // Ensure all scenario client progress has been processed
  await scenarioClientProgress

  return { scenarioData, wsdotResult: wsdotResult }
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
    console.log(`Analyzed ${weekdayFreq.stops.size} stops for weekday`)
    const weekendFreq = extractFrequencyData(this.scenarioData, this.config.weekendDate)
    console.log(`Analyzed ${weekendFreq.stops.size} stops routes for weekend`)

    const results: Record<string, Set<number>> = {}
    const levelStops: Record<string, number[]> = {}
    const levelLayers: Record<string, Record<string, GeographyDataFeature[]>> = {}
    const getGeographyLayers = ['tract', 'state'] // 'state', 'county',

    // Process each service level
    for (const [levelKey, config] of Object.entries(SERVICE_LEVELS)) {
      console.log(`===== Processing ${levelKey} =====`)
      const qualifyingStops = processServiceLevel(config, weekdayFreq, weekendFreq)
      levelStops[levelKey] = Array.from(qualifyingStops)
      results[levelKey] = qualifyingStops
      console.log(`${levelKey}: ${qualifyingStops.size} qualifying stops`)
    }

    // Fetch geography data for the stops in each level (and all stops)
    const baseGeographyConfig: getGeographyDataConfig = {
      client: this.client,
      tableDatasetName: 'acsdt5y2022',
      tableDatasetTable: `b01001`,
      tableDatasetTableCol: 'b01001_001',
      geoDatasetName: 'tiger2024',
      geoDatasetLayer: 'tract',
    }

    // Get bbox population (tract intersections)
    console.log(`Fetching tract populations for bbox...`)
    const bboxIntersection = await getGeographyData({
      ...baseGeographyConfig,
      geoDatasetLayer: 'tract',
      bbox: this.config.bbox,
    })

    for (const [levelKey, stopIds] of Object.entries(results)) {
      console.log(`\n====== ${levelKey} ======`)
      console.log(`${levelKey}: ${stopIds.size} qualifying stops`)
      const geogLayers: Record<string, GeographyDataFeature[]> = {}
      for (const geoDatasetLayer of getGeographyLayers) {
        if ((this.config?.stopBufferRadius || 0) <= 0) {
          console.warn('getGeographyData: stopBufferRadius is zero or negative, skipping geography fetch')
          continue
        }
        if (stopIds.size === 0) {
          continue
        }
        const geoConfig: getGeographyDataConfig = {
          ...baseGeographyConfig,
          stopIds: stopIds,
          geoDatasetLayer: geoDatasetLayer,
          stopBufferRadius: this.config.stopBufferRadius || 0,
          includeIntersectionGeometry: true
        }
        console.log(`Fetching geography data for layer: ${geoConfig.geoDatasetName}:${geoDatasetLayer} table ${geoConfig.tableDatasetName}:${geoConfig.tableDatasetTable}:${geoConfig.tableDatasetTableCol} with ${stopIds.size} stop IDs`)
        const data = await getGeographyData(geoConfig)
        geogLayers[geoDatasetLayer] = data
      }
      levelLayers[levelKey] = geogLayers
    }

    // Build final result
    const stops: WSDOTStopResult[] = []
    const allStopIds = new Set([...weekdayFreq.stops.keys(), ...weekendFreq.stops.keys()])
    for (const stopId of allStopIds) {
      const stop = this.scenarioData.stops.find(s => s.id === stopId)
      if (!stop?.geometry) {
        continue
      }
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
        levelNights: results.levelNights?.has(stopId) || false,
        levelAll: true,
      }
      stops.push(result)
    }

    console.log('WSDOT frequency analysis completed...')
    return {
      stops,
      levelStops,
      levelLayers,
      bboxIntersection
    }
  }
}

function extractFrequencyData (data: ScenarioData, date: Date): {
  stops: Map<number, StopFrequencyData>
  routes: Map<number, RouteFrequencyData>
} {
  const dateStr = fmtDate(date)
  console.log('Processing frequency data for date:', dateStr)
  const stops = new Map<number, StopFrequencyData>()
  const routes = new Map<number, RouteFrequencyData>()

  for (const route of data.routes) {
    const routeData = {
      routeId: route.id,
      route: route,
      hourlyDepartures: new Map<number, Map<number, StopTime[]>>(),
      hourlyMaxTph: new Map<number, number>(),
      stopIds: new Set<number>(),
    }
    routes.set(route.id, routeData)
  }

  let depCount = 0

  // Process each stop
  for (const stop of data.stops) {
    // console.log('\tstop:', stop.id, stop.stop_name)
    const departures = data.stopDepartureCache.get(stop.id, dateStr)

    const stopData: StopFrequencyData = {
      stopId: stop.id,
      hourlyDepartures: new Map<number, StopTime[]> (),
      routeIds: new Set<number>()
    }

    // Count trips by hour
    for (const departure of departures) {
      // console.log('\t\tdeparture:', departure)
      if (!departure.departure_time) {
        console.log('\t\t\tno departure time, skipping')
        continue
      }
      depCount += 1
      if (depCount % 1000 === 0) {
        console.log(`\tProcessed ${depCount} departures...`)
      }
      const hour = parseHour(departure.departure_time)
      const stopHourData = stopData.hourlyDepartures.get(hour) || []
      stopHourData.push(departure)
      stopData.hourlyDepartures.set(hour, stopHourData)
      stopData.routeIds.add(departure.trip.route.id)
      // console.log('\t\tstop data:', stopData)

      const routeId = departure.trip.route.id
      const routeData = routes.get(routeId)
      if (!routeData) {
        console.warn(`Route ID ${routeId} not found for departure, skipping`)
        continue
      }
      const routeHourData = routeData.hourlyDepartures.get(hour) || new Map<number, StopTime[]>()
      const routeHourStopData = routeHourData.get(stop.id) || []
      routeHourStopData.push(departure)
      routeHourData.set(stop.id, routeHourStopData)
      routeData.hourlyDepartures.set(hour, routeHourData)
      routeData.stopIds.add(stop.id)
      routes.set(routeId, routeData)
    }
    stops.set(stop.id, stopData)
  }

  // Compute max TPH for each route
  for (const routeData of routes.values()) {
    for (const directionId of [0, 1]) {
      for (const [hour, stopMap] of routeData.hourlyDepartures) {
        for (const [_, stopTimes] of stopMap.entries()) {
          const dirCount = stopTimes.filter(st => st.trip.direction_id === directionId).length
          const currentMax = routeData.hourlyMaxTph.get(hour) || 0
          routeData.hourlyMaxTph.set(hour, Math.max(currentMax, dirCount))
        }
      }
    }
    console.log(`Route ${routeData.route.route_id}: ${routeData.route.route_short_name} - ${routeData.route.route_long_name} max TPH by hour:`)
    for (let i = 0; i < 24; i++) {
      console.log(`\thour ${i}: ${routeData.hourlyMaxTph.get(i) || 0} tph`)
    }
  }

  // Summary
  const totalHourlyDepartures: Map<number, number> = new Map()
  for (const sd of stops.values()) {
    for (const [hour, count] of Object.entries(sd.hourlyDepartures)) {
      totalHourlyDepartures.set(parseInt(hour), (totalHourlyDepartures.get(parseInt(hour)) || 0) + count.length)
    }
  }
  console.log(`Processed ${stops.size} date ${date} stops with ${depCount} total departures`)
  for (let i = 0; i < 24; i++) {
    console.log(`\thour ${i}: ${totalHourlyDepartures.get(i) || 0} departures`)
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
  config: ServiceLevelConfig,
  weekdayFreq: { stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData> },
  weekendFreq: { stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData> }
): Set<number> {
  // Include all stops if configured
  if (config.includeAll) {
    const allStops = new Set<number>([...weekdayFreq.stops.keys(), ...weekendFreq.stops.keys()])
    console.log(`Including all stops: ${allStops.size}`)
    return allStops
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

  // Weekend hours analysis
  if (config.weekend) {
    const weekendStops = analyzeFrequency(weekendFreq.stops, weekendFreq.routes, config.weekend)
    console.log(`Stops meeting weekend criteria: ${weekendStops.size}`)
    stopResults.push(weekendStops)
  }

  // Handle total trips threshold levels (level5 and level6)
  if (config.any) {
    const totalTripStops = analyzeFrequency(weekdayFreq.stops, weekdayFreq.routes, config.any)
    console.log(`Stops meeting total trips criteria: ${totalTripStops.size}`)
    stopResults.push(totalTripStops)
  }

  // Merge stop-level results (intersection)
  let mergedStops = stopResults.length > 0 ? stopResults[0] : new Set<number>()
  for (let i = 1; i < stopResults.length; i++) {
    mergedStops = intersection(mergedStops, stopResults[i])
  }

  return mergedStops
}

function analyzeFrequency (stops: Map<number, StopFrequencyData>, routes: Map<number, RouteFrequencyData>, timeConfig: TimeConfig): Set<number> {
  const qualifyingStops = new Set<number>()
  for (const [stopId, stopData] of stops) {
    let totalTrips = 0
    let meetsTph = true
    for (const hour of timeConfig.hours) {
      const departures = (stopData.hourlyDepartures.get(hour) || []).length
      if (departures < timeConfig.min_tph) {
        meetsTph = false
      }
      totalTrips += departures
    }
    if (!meetsTph) {
      continue
    }
    if (totalTrips < timeConfig.min_total) {
      continue
    }
    qualifyingStops.add(stopId)
  }

  // Calculate all routes that satisfy timeConfig
  // Process all departures for all stops in this hour
  const qualifyingRouteStops = new Set<number>()
  for (const routeData of routes.values()) {
    let totalTrips = 0
    let meetsTph = true
    for (const hour of timeConfig.hours) {
      const routeHourTph = routeData.hourlyMaxTph.get(hour) || 0
      totalTrips += routeHourTph
      if (routeHourTph < timeConfig.min_tph) {
        meetsTph = false
      }
    }
    if (!meetsTph) {
      continue
    }
    if (totalTrips < timeConfig.min_total) {
      // console.log('\tdoes not meet total trips requirements')
      continue
    }
    // console.log('\tqualifies')
    for (const stopId of routeData.stopIds) {
      qualifyingRouteStops.add(stopId)
    }
  }
  return intersection(qualifyingStops, qualifyingRouteStops)
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

interface getGeographyDataConfig {
  client: GraphQLClient
  tableDatasetName: string
  tableDatasetTable: string
  tableDatasetTableCol: string
  geoDatasetName: string
  geoDatasetLayer: string
  stopIds?: Set<number>
  stopBufferRadius?: number
  includeIntersectionGeometry?: boolean
  bbox?: Bbox
}

async function getGeographyData (
  config: getGeographyDataConfig,
): Promise<GeographyDataFeature[]> {
  const variables = {
    geoDatasetName: config.geoDatasetName,
    tableDatasetName: config.tableDatasetName,
    tableNames: [config.tableDatasetTable],
    layer: config.geoDatasetLayer,
    stopBufferRadius: config.stopBufferRadius,
    stopIds: Array.from(config.stopIds || []),
    bbox: convertBbox(config.bbox),
    includeIntersectionGeometry: config.includeIntersectionGeometry || false,
  }
  const result = await config.client.query<{ census_datasets: geographyIntersectionResult[] }>(geographyIntersectionQuery, variables)
  const features: GeographyDataFeature[] = []
  for (const geoDataset of result.data?.census_datasets || []) {
    // console.log('Geography dataset:', geoDataset.name)
    for (const geography of geoDataset.geographies || []) {
      // console.log(`Geography feature: ${geography.name} (layer: ${geography.layer_name} geoid: ${geography.geoid})`)
      const totalArea = geography.geometry_area || 0
      const intersectionArea = geography.intersection_area || 0
      if (totalArea === 0) {
        continue
      }
      const intersectionRatio = Math.min(intersectionArea / totalArea, 1.0)
      const totalPop = geography.values
        .find(v => v.dataset_name === config.tableDatasetName)
        ?.values[config.tableDatasetTableCol]
        || 0
      // console.log(`\tPopulation: ${totalPop}`)
      // console.log(`\tArea: ${totalArea}`)
      // console.log(`\tIntersection area: ${intersectionArea}`)
      // console.log(`\tIntersection ratio: ${intersectionRatio}`)
      // console.log(`\tIntersection pop: ${totalPop * intersectionRatio}`)
      features.push({
        id: geography.geoid,
        type: 'Feature',
        properties: {
          name: geography.name,
          total_population: totalPop,
          intersection_population: totalPop * intersectionRatio,
          layer_name: geography.layer_name,
          dataset_name: geoDataset.name,
          adm1_iso: geography.adm1_iso,
          adm1_name: geography.adm1_name,
          adm0_iso: geography.adm0_iso,
          adm0_name: geography.adm0_name,
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
    adm0_name: string
    adm0_iso: string
    adm1_name: string
    adm1_iso: string
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
query ($geoDatasetName: String, $layer: String!, $tableNames: [String!]!, $tableDatasetName: String, $bbox: BoundingBox, $stopIds: [Int!],  $stopBufferRadius: Float, $includeIntersectionGeometry: Boolean = false) {
  census_datasets(limit: 1000, where: {name: $geoDatasetName}) {
    id
    name
    url
    geographies(limit: 1000, where: {layer: $layer, location: {bbox:$bbox, stop_buffer: {stop_ids: $stopIds, radius: $stopBufferRadius}}}) {
      id
      name
      aland
      awater
      geoid
      adm1_iso
      adm1_name
      adm0_iso
      adm0_name
      layer_name
      geometry_area
      intersection_area
      intersection_geometry @include(if: $includeIntersectionGeometry)
      values(dataset: $tableDatasetName, table_names: $tableNames) {
        dataset_name
        geoid
        values
      }
    }
  }
}
`
