import {
  requestStream,
  fmtDate,
  parseDate,
  type GraphQLClient,
  type Geometry,
  type Bbox,
  chunkArray,
} from '~~/src/core'
import { type ScenarioData, type ScenarioConfig, ScenarioStreamSender, ScenarioFetcher, ScenarioDataReceiver, type ScenarioCallbacks, type ScenarioReceiverOptions, type ScenarioProgress } from '~~/src/scenario'
import { fetchCensusIntersection, type CensusGeographyFeature } from '~~/src/tl'
import { SERVICE_LEVELS, processServiceLevel } from './service-levels'
import { WSDOTFrequencyAggregator, type FrequencyLabels } from './frequency'

// Re-export the public service-level config so consumers (e.g. wsdot-viewer.vue)
// keep importing it from ~~/src/analysis/wsdot.
export { SERVICE_LEVELS, levelColors, type LevelKey } from './service-levels'
export { WSDOTFrequencyAggregator, type FrequencyData, type FrequencyLabels } from './frequency'

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

// The calendar dates the report reads: the weekday, the weekend day, and the
// day after the weekday, whose early hours are the post-midnight half of the
// night segments. Everything else in the scenario's date range is fetched (the
// client's map and tables show it) but never folded.
//
// The config crosses a JSON boundary on the server, so these are strings at
// runtime rather than the Dates the type states.
export function wsdotReportDates (config: WSDOTReportConfig): Date[] {
  const weekday = configDate(config.weekdayDate)
  const overnight = new Date(weekday.valueOf())
  overnight.setDate(overnight.getDate() + 1)
  return [weekday, configDate(config.weekendDate), overnight]
}

// A bare `yyyy-MM-dd` is parsed as local midnight. `new Date()` would read it
// as UTC midnight, which lands on the day before west of Greenwich, and the
// dates the departures phase files under are local.
function configDate (value: Date | string): Date {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDate(value)!
  }
  return new Date(value.valueOf())
}

export interface WSDOTAnalysisOptions {
  /**
   * Keep route geometry in the returned ScenarioData. The HTTP endpoint
   * discards the return value and browser consumers rebuild from the stream,
   * so it defaults off: the shapes still go out on the wire, the server just
   * does not hold a second copy of them.
   */
  retainRouteGeometry?: boolean
}

export async function runAnalysis (
  controller: ReadableStreamDefaultController,
  config: WSDOTReportConfig,
  client: GraphQLClient,
  opts: WSDOTAnalysisOptions = {},
): Promise<{ scenarioData: ScenarioData, wsdotResult: WSDOTReport }> {
  const writer = requestStream(controller).getWriter()
  const scenarioDataSender = new ScenarioStreamSender(writer)

  // TODO: ScenarioFetcher fetches census values from configCopy here, but
  // WSDOT re-queries them via getGeographyData and ignores the scenario map.
  // Drop the duplicate once WSDOT consumes CensusGeographyData directly.
  //
  // Flex is off regardless of what the browse config asked for: no part of the
  // report reads flex areas or flex departures, and the phase costs a request
  // per feed version.
  const configCopy = { ...config, routeHourCompatMode: true, includeFlexAreas: false }

  // Departures are folded into per-hour counters as they stream rather than
  // accumulated. The report reads only counts, and holding every departure is
  // what put a statewide run over the Worker's memory limit. Stops, routes and
  // feed versions are still accumulated: the stop table is built from them,
  // and so is the stops-and-routes report layered on top of this one.
  const frequency = new WSDOTFrequencyAggregator(wsdotReportDates(config))
  const receiver = new ScenarioDataReceiver({
    onProgress: progress => scenarioDataSender.onProgress(progress),
    onError: error => scenarioDataSender.onError(error),
  }, {
    onStopDepartures: departures => frequency.addDepartures(departures),
    dropRouteGeometry: !opts.retainRouteGeometry,
  })

  // Send config as initial extra data
  scenarioDataSender.onProgress({
    isLoading: true,
    currentStage: 'ready',
    currentStageMessage: 'Starting WSDOT fetcher',
    config: config,
  })

  // Start the fetch process
  const fetcher = new ScenarioFetcher(configCopy, client, receiver)
  await fetcher.fetch()

  const scenarioData = receiver.getCurrentData()

  // Update the client with the wsdot result
  scenarioDataSender.onProgress({
    isLoading: true,
    currentStage: 'extra',
    currentStageMessage: 'Running WSDOT frequency analysis...'
  })

  // The report is returned directly rather than reassembled from the stream
  // the way a browser consumer does, so a failed analysis still leaves the
  // caller with the empty report and the scenario data behind it.
  let wsdotResult: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }
  try {
    const wsdotFetcher = new WSDOTReportFetcher(configCopy, scenarioData, frequency, client, scenarioDataSender)
    wsdotResult = await wsdotFetcher.fetch()
  } catch (e) {
    console.error('WSDOT analysis error:', e)
    scenarioDataSender.onError({ message: `WSDOT analysis error: ${e}` })
  }

  // Complete the scenario data stream
  scenarioDataSender.onComplete()
  await writer.close()

  return { scenarioData, wsdotResult }
}

export class WSDOTReportFetcher {
  private config: WSDOTReportConfig
  private scenarioData: ScenarioData
  private frequency: WSDOTFrequencyAggregator
  private client: GraphQLClient
  private progressSender: ScenarioStreamSender

  constructor (
    config: WSDOTReportConfig,
    data: ScenarioData,
    frequency: WSDOTFrequencyAggregator,
    client: GraphQLClient,
    progressSender: ScenarioStreamSender
  ) {
    this.config = config
    this.scenarioData = data
    this.frequency = frequency
    this.client = client
    this.progressSender = progressSender
  }

  async fetch (): Promise<WSDOTReport> {
    console.log('Starting WSDOT frequency analysis...')

    const labels = frequencyLabels(this.scenarioData)
    const [weekdayDate, weekendDate, overnightDate] = wsdotReportDates(this.config)

    // Extract frequency data for weekday and weekend
    const weekdayFreq = this.buildFrequencyData(weekdayDate!, labels, 'weekday')
    const weekendFreq = this.buildFrequencyData(weekendDate!, labels, 'weekend')

    // Departures land on the calendar day they run, so the night that follows
    // the weekday is in the next day's data. Its early hours feed the night
    // segments; the scenario range must extend a day past weekdayDate for
    // levelNights to see anything.
    const overnightFreq = this.buildFrequencyData(overnightDate!, labels, 'overnight')
    if (this.frequency.departureCount(overnightDate!) === 0) {
      console.warn(`No departures on ${fmtDate(overnightDate)} — night service after ${fmtDate(weekdayDate)} cannot be evaluated`)
    }

    const results: Record<string, Set<number>> = {}
    const levelStops: Record<string, number[]> = {}
    const levelLayers: Record<string, Record<string, GeographyDataFeature[]>> = {}
    const getGeographyLayers = ['tract', 'state'] // 'state', 'county',

    // Process each service level
    for (const [levelKey, config] of Object.entries(SERVICE_LEVELS)) {
      console.log(`===== Processing ${levelKey} =====`)
      const qualifyingStops = processServiceLevel(config, weekdayFreq, weekendFreq, overnightFreq, this.config.routeHourCompatMode)
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

    // Build final result. Every stop in the scenario is listed, which is what
    // the frequency maps' domain gave before they were built from counters.
    const stops: WSDOTStopResult[] = []
    const seenStopIds = new Set<number>()

    for (const stop of this.scenarioData.stops) {
      const stopId = stop.id
      if (!stop.geometry || seenStopIds.has(stopId)) {
        continue
      }
      seenStopIds.add(stopId)
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
    return { stops, levelStops, levelLayers, bboxIntersection }
  }

  // One date's frequency maps, plus the per-hour summary the cache-based
  // extraction used to print while it walked the departures.
  private buildFrequencyData (date: Date, labels: FrequencyLabels, label: string) {
    const freq = this.frequency.build(date, labels)
    const dateStr = fmtDate(date)
    console.log(`Analyzed ${freq.stops.size} stops for ${label} ${dateStr} with ${this.frequency.departureCount(date)} departures`)
    const totals = this.frequency.hourlyTotals(date)
    for (let hour = 0; hour < totals.length; hour++) {
      console.log(`\thour ${hour}: ${totals[hour]} departures`)
    }
    return freq
  }
}

// Numeric id -> GTFS id for every stop and route the scenario fetched. These
// are the domain the frequency maps are built over, so a stop with no service
// still appears with empty counters.
function frequencyLabels (data: ScenarioData): FrequencyLabels {
  const stopGtfsIds = new Map<number, string>()
  for (const stop of data.stops) {
    stopGtfsIds.set(stop.id, stop.stop_id)
  }
  const routeGtfsIds = new Map<number, string>()
  for (const route of data.routes) {
    routeGtfsIds.set(route.id, route.route_id)
  }
  return { stopGtfsIds, routeGtfsIds }
}

/**
 * Specialized receiver that extends ScenarioDataReceiver to handle WSDOT report aggregation
 * Accumulates scenario data and merges batched WSDOT report data from extraData
 *
 * For browser consumers, which reassemble the report from the NDJSON stream.
 * The server builds it in-process and returns it from runAnalysis instead.
 */
export class WSDOTReportDataReceiver extends ScenarioDataReceiver {
  private wsdotReport: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }

  constructor (callbacks: ScenarioCallbacks = {}, options: ScenarioReceiverOptions = {}) {
    super(callbacks, options)
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
