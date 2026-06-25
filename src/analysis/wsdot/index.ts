import {
  multiplexStream,
  requestStream,
  fmtDate,
  type GraphQLClient,
  type Geometry,
  type Bbox,
  chunkArray,
} from '~~/src/core'
import { type ScenarioData, type ScenarioConfig, ScenarioStreamSender, ScenarioFetcher, ScenarioDataReceiver, ScenarioStreamReceiver, type ScenarioCallbacks, type ScenarioProgress } from '~~/src/scenario'
import { fetchCensusIntersection, type CensusGeographyFeature, type StopTimeCacheItem } from '~~/src/tl'
import {
  SERVICE_LEVELS,
  processServiceLevel,
  type StopFrequencyData,
  type RouteFrequencyData,
} from './service-levels'

// Re-export the public service-level config so consumers (e.g. wsdot-viewer.vue)
// keep importing it from ~~/src/analysis/wsdot.
export { SERVICE_LEVELS, levelColors, type LevelKey } from './service-levels'

// Constants for progress updates
const PROGRESS_LIMIT_STOPS = 1000
const PROGRESS_LIMIT_BBOX_FEATURES = 100

export interface WSDOTReport {
  stops: WSDOTStopResult[]
  levelStops: Record<string, number[]>
  levelLayers: Record<string, Record<string, GeographyDataFeature[]>>
  bboxIntersection: GeographyDataFeature[]
}

export interface WSDOTStopResult {
  feedOnestopId: string
  feedVersionSha1: string
  stateName: string
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
  stopBufferRadius: number
  tableDatasetName: string
  tableDatasetTable: string
  tableDatasetTableCol: string
  geoDatasetName: string
  geoDatasetLayer: string
  routeHourCompatMode: boolean
}

export async function runAnalysis (controller: ReadableStreamDefaultController, config: WSDOTReportConfig, client: GraphQLClient): Promise<{ scenarioData: ScenarioData, wsdotResult: WSDOTReport }> {
  // Create a multiplex stream that writes to both the response and a new output stream
  const { inputStream, outputStream } = multiplexStream(requestStream(controller))
  const writer = inputStream.getWriter()

  // TODO: ScenarioFetcher fetches census values from configCopy here, but
  // WSDOT re-queries them via getGeographyData and ignores the scenario map.
  // Drop the duplicate once WSDOT consumes CensusGeographyData directly.
  const configCopy = { ...config, departureMode: 'all' as const, routeHourCompatMode: true }
  const scenarioDataSender = new ScenarioStreamSender(writer)
  const fetcher = new ScenarioFetcher(configCopy, client, scenarioDataSender)

  // Send config as initial extra data
  scenarioDataSender.onProgress({
    isLoading: true,
    currentStage: 'ready',
    currentStageMessage: 'Starting WSDOT fetcher',
    config: config,
  })

  // Configure client/receiver - use specialized WSDOT receiver
  const receiver = new WSDOTReportDataReceiver()
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

  try {
    const wsdotFetcher = new WSDOTReportFetcher(configCopy, scenarioData, client, scenarioDataSender)
    await wsdotFetcher.fetch()
  } catch (e) {
    console.error('WSDOT analysis error:', e)
    scenarioDataSender.onError({ message: `WSDOT analysis error: ${e}` })
  }

  // Complete the scenario data stream
  scenarioDataSender.onComplete()

  // Final complete - close the multiplexed stream
  writer.close()

  // Ensure all scenario client progress has been processed
  const { success } = await scenarioClientProgress
  if (!success) {
    console.warn('WSDOT stream ended without completion message')
  }

  // Get the final accumulated data from the receiver
  const { scenarioData: finalScenarioData, wsdotReport } = receiver.getCurrentCombinedData()
  return { scenarioData: finalScenarioData, wsdotResult: wsdotReport }
}

export class WSDOTReportFetcher {
  private config: WSDOTReportConfig
  private scenarioData: ScenarioData
  private client: GraphQLClient
  private progressSender: ScenarioStreamSender

  constructor (
    config: WSDOTReportConfig,
    data: ScenarioData,
    client: GraphQLClient,
    progressSender: ScenarioStreamSender
  ) {
    this.config = config
    this.scenarioData = data
    this.client = client
    this.progressSender = progressSender
  }

  async fetch () {
    console.log('Starting WSDOT frequency analysis...')

    // Extract frequency data for weekday and weekend
    const weekdayFreq = extractFrequencyData(this.scenarioData, this.config.weekdayDate)
    console.log(`Analyzed ${weekdayFreq.stops.size} stops for weekday ${this.config.weekdayDate}`)
    const weekendFreq = extractFrequencyData(this.scenarioData, this.config.weekendDate)
    console.log(`Analyzed ${weekendFreq.stops.size} stops routes for weekend ${this.config.weekendDate}`)

    const results: Record<string, Set<number>> = {}
    const levelStops: Record<string, number[]> = {}
    const levelLayers: Record<string, Record<string, GeographyDataFeature[]>> = {}
    const getGeographyLayers = ['tract', 'state'] // 'state', 'county',

    // Process each service level
    for (const [levelKey, config] of Object.entries(SERVICE_LEVELS)) {
      console.log(`===== Processing ${levelKey} =====`)
      const qualifyingStops = processServiceLevel(config, weekdayFreq, weekendFreq, this.config.routeHourCompatMode)
      levelStops[levelKey] = Array.from(qualifyingStops)
      results[levelKey] = qualifyingStops
      console.log(`${levelKey}: ${qualifyingStops.size} qualifying stops`)
    }

    // Fetch geography data for the stops in each level (and all stops)
    const baseGeographyConfig: getGeographyDataConfig = {
      client: this.client,
      tableDatasetName: this.config.tableDatasetName,
      tableDatasetTable: this.config.tableDatasetTable,
      tableDatasetTableCol: this.config.tableDatasetTableCol,
      geoDatasetName: this.config.geoDatasetName,
      geoDatasetLayer: this.config.geoDatasetLayer,
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
      const stateName = (stop.census_geographies || []).find(g => g.layer_name === this.config.aggregateLayer)?.name || ''
      stops.push({
        feedOnestopId: stop.feed_version?.feed?.onestop_id,
        feedVersionSha1: stop.feed_version?.sha1,
        stateName: stateName,
        stopId: stop.stop_id,
        stopName: stop.stop_name || '',
        stopLat: stop.geometry.coordinates[1] ?? 0,
        stopLon: stop.geometry.coordinates[0] ?? 0,
        level6: results.level6?.has(stopId) || false,
        level5: results.level5?.has(stopId) || false,
        level4: results.level4?.has(stopId) || false,
        level3: results.level3?.has(stopId) || false,
        level2: results.level2?.has(stopId) || false,
        level1: results.level1?.has(stopId) || false,
        levelNights: results.levelNights?.has(stopId) || false,
        levelAll: true,
      })
    }

    // Send stops in batches using the generic helper function
    const stopChunks = chunkArray(stops, PROGRESS_LIMIT_STOPS)
    for (let i = 0; i < stopChunks.length; i++) {
      this.progressSender.onProgress({
        isLoading: true,
        currentStage: 'extra',
        extraData: { stops: stopChunks[i], levelStops: {}, levelLayers: {}, bboxIntersection: [] },
        currentStageMessage: `WSDOT stops batch ${i + 1} of ${stopChunks.length}...`
      })
    }

    // Send levelStops by individual level
    for (const [levelKey, stopIds] of Object.entries(levelStops)) {
      this.progressSender.onProgress({
        isLoading: true,
        currentStage: 'extra',
        extraData: { stops: [], levelStops: { [levelKey]: stopIds }, levelLayers: {}, bboxIntersection: [] },
        currentStageMessage: `WSDOT service level stops for ${levelKey}...`
      })
    }

    // Send geography layers in batches using the generic helper function
    for (const [levelKey, layers] of Object.entries(levelLayers)) {
      for (const [layerName, features] of Object.entries(layers)) {
        const featureChunks = chunkArray(features, PROGRESS_LIMIT_STOPS)
        for (let i = 0; i < featureChunks.length; i++) {
          const chunk = featureChunks[i] ?? []
          const batchLevelLayers: Record<string, Record<string, GeographyDataFeature[]>> = {
            [levelKey]: {
              [layerName]: chunk
            }
          }
          this.progressSender.onProgress({
            isLoading: true,
            currentStage: 'extra',
            extraData: { stops: [], levelStops: {}, levelLayers: batchLevelLayers, bboxIntersection: [] },
            currentStageMessage: `WSDOT ${levelKey} ${layerName} batch ${i + 1} of ${featureChunks.length}...`
          })
        }
      }
    }

    // Send bboxIntersection in batches using the generic helper function
    const bboxChunks = chunkArray(bboxIntersection, PROGRESS_LIMIT_BBOX_FEATURES)
    for (let i = 0; i < bboxChunks.length; i++) {
      this.progressSender.onProgress({
        isLoading: true,
        currentStage: 'extra',
        extraData: { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: bboxChunks[i] },
        currentStageMessage: `WSDOT bbox intersection batch ${i + 1} of ${bboxChunks.length}...`
      })
    }

    console.log('WSDOT frequency analysis completed...')
  }
}

/**
 * Specialized receiver that extends ScenarioDataReceiver to handle WSDOT report aggregation
 * Accumulates scenario data and merges batched WSDOT report data from extraData
 */
export class WSDOTReportDataReceiver extends ScenarioDataReceiver {
  private wsdotReport: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }

  constructor (callbacks: ScenarioCallbacks = {}) {
    super(callbacks)
  }

  override onProgress (progress: ScenarioProgress): void {
    super.onProgress(progress)

    // Handle WSDOT report extraData aggregation
    if (progress.extraData) {
      this.mergeWSDOTReportData(progress.extraData as WSDOTReport)
    }
  }

  private mergeWSDOTReportData (extraData: WSDOTReport): void {
    // Merge stops by appending new ones
    if (extraData.stops) {
      this.wsdotReport.stops.push(...extraData.stops)
    }

    // Merge levelStops by assigning/updating object properties
    if (extraData.levelStops) {
      Object.assign(this.wsdotReport.levelStops, extraData.levelStops)
    }

    // Deep merge levelLayers - merge each level and append to existing layer arrays
    if (extraData.levelLayers) {
      for (const [levelKey, layers] of Object.entries(extraData.levelLayers)) {
        if (!this.wsdotReport.levelLayers[levelKey]) {
          this.wsdotReport.levelLayers[levelKey] = {}
        }
        for (const [layerName, features] of Object.entries(layers)) {
          if (!this.wsdotReport.levelLayers[levelKey][layerName]) {
            this.wsdotReport.levelLayers[levelKey][layerName] = []
          }
          this.wsdotReport.levelLayers[levelKey][layerName].push(...features)
        }
      }
    }

    // Merge bboxIntersection by appending new features
    if (extraData.bboxIntersection) {
      this.wsdotReport.bboxIntersection.push(...extraData.bboxIntersection)
    }
  }

  /**
   * Get the current accumulated WSDOT report
   */
  getCurrentWSDOTReport (): WSDOTReport {
    return { ...this.wsdotReport }
  }

  /**
   * Get both scenario data and WSDOT report
   */
  getCurrentCombinedData (): { scenarioData: ScenarioData, wsdotReport: WSDOTReport } {
    return {
      scenarioData: this.getCurrentData(),
      wsdotReport: this.getCurrentWSDOTReport()
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
      stopHourlyDepartures: new Map<number, Map<number, StopTimeCacheItem[]>>(),
      hourlyDepartures: new Map<number, StopTimeCacheItem[]>(),
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
      gtfsStopId: stop.stop_id,
      hourlyDepartures: new Map<number, StopTimeCacheItem[]> (),
      routeIds: new Set<number>()
    }

    // Count trips by hour
    for (const departure of departures) {
      // console.log('\t\tdeparture:', departure)
      if (departure.departureTime < 0) {
        console.log('\t\t\tno departure time, skipping')
        continue
      }
      depCount += 1
      if (depCount % 1000 === 0) {
        console.log(`\tProcessed ${depCount} departures...`)
      }
      const routeId = departure.routeId
      const hour = parseHour(departure.departureTime)
      const stopHourData = stopData.hourlyDepartures.get(hour) || []
      stopHourData.push(departure)
      stopData.hourlyDepartures.set(hour, stopHourData)
      stopData.routeIds.add(routeId)
      // console.log('\t\tstop data:', stopData)

      const routeData = routes.get(routeId)
      if (!routeData) {
        console.warn(`Route ID ${routeId} not found for departure, skipping`)
        continue
      }
      const routeHourData = routeData.hourlyDepartures.get(hour) || []
      routeHourData.push(departure)
      routeData.hourlyDepartures.set(hour, routeHourData)
      routeData.stopIds.add(stop.id)
      routes.set(routeId, routeData)
    }
    stops.set(stop.id, stopData)
  }

  // Summary
  const totalHourlyDepartures: Map<number, number> = new Map()
  for (const sd of stops.values()) {
    for (const [hour, count] of sd.hourlyDepartures.entries()) {
      totalHourlyDepartures.set(hour, (totalHourlyDepartures.get(hour) || 0) + count.length)
    }
  }
  console.log(`Processed ${stops.size} date ${date} stops with ${depCount} total departures`)
  for (let i = 0; i < 24; i++) {
    console.log(`\thour ${i}: ${totalHourlyDepartures.get(i) || 0} departures`)
  }
  return { stops, routes }
}

function parseHour (seconds: number): number {
  // Convert seconds since midnight to hour of day (0-23)
  let hour = Math.floor(seconds / 3600)
  // Handle GTFS 24+ hour format
  if (hour >= 24) {
    hour = hour - 24
  }
  return hour
}

////////////////
// Fetch geography data for a set of stop IDs
////////////////

// Adds pre-computed total_population/intersection_population from the
// configured tableDatasetTableCol on top of CensusGeographyFeature.
interface GeographyDataFeature {
  id: string
  type: string
  properties: CensusGeographyFeature['properties'] & {
    total_population: number
    intersection_population: number
    [key: string]: any
  }
  geometry: Geometry | null
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
  const features = await fetchCensusIntersection({
    client: config.client,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.geoDatasetLayer,
    tableDatasetName: config.tableDatasetName,
    tableNames: [config.tableDatasetTable],
    bbox: config.bbox,
    stopIds: config.stopIds,
    stopBufferRadius: config.stopBufferRadius,
    includeIntersectionGeometry: config.includeIntersectionGeometry,
  })
  return features.map((f): GeographyDataFeature => {
    const totalPop = f.properties.values[config.tableDatasetTableCol] || 0
    return {
      ...f,
      properties: {
        ...f.properties,
        total_population: totalPop,
        intersection_population: totalPop * f.properties.intersection_ratio,
      },
    }
  })
}
