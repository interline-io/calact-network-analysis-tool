import {
  requestStream,
  fmtDate,
  parseDate,
  type GraphQLClient,
  type Geometry,
  type Bbox,
  chunkArray,
} from '~~/src/core'
import { type ScenarioData, type ScenarioConfig, ScenarioStreamSender, ScenarioFetcher, ScenarioDataReceiver, StopDepartureTuple, type ScenarioProgress } from '~~/src/scenario'
import { fetchCensusIntersection, type CensusGeographyFeature } from '~~/src/tl'
import { SERVICE_LEVELS, processServiceLevel } from './service-levels'
import { WSDOTFrequencyAggregator, type FrequencyLabels } from './frequency'
import { WSDOTStopCollector } from './stops'

// Re-export the public service-level config so consumers (e.g. wsdot-viewer.vue)
// keep importing it from ~~/src/analysis/wsdot.
export { SERVICE_LEVELS, levelColors, type LevelKey } from './service-levels'
export { WSDOTFrequencyAggregator, type FrequencyData, type FrequencyLabels } from './frequency'
export { WSDOTStopCollector, type WSDOTStopRecord } from './stops'

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

/**
 * What the analysis stage needs to reach the client. Narrower than the stream
 * sender, so the report fetcher cannot close or complete the stream from under
 * runAnalysis.
 */
export interface WSDOTProgressSink {
  onProgress: (progress: ScenarioProgress) => void
}

export interface WSDOTAnalysisOptions {
  /**
   * Populate the returned ScenarioData with whole stops and routes.
   *
   * The report is built from folded records, so nothing here needs them, and
   * the HTTP endpoint discards the return value entirely while browser
   * consumers rebuild from the stream. Only a caller that reads the returned
   * ScenarioData sets this, which today is the stops-and-routes report.
   *
   * Left off, `scenarioData.stops` is empty and its routes carry no geometry.
   * Both still go out on the wire untouched; the server just does not hold a
   * second copy of what it is relaying.
   */
  retainScenarioEntities?: boolean
}

/**
 * The calendar dates the departures phase has to fetch for the report.
 *
 * The report reads three days, but a departure stated past 24:00:00 belongs to
 * the day after its service date, so the day before each is fetched too. That
 * matters here more than most places: levelNights is entirely about service
 * that runs past midnight, and a Saturday-only late trip landing on the
 * Sunday being analyzed would be invisible without its service date.
 *
 * The result is five dates for the usual weekday/weekend pair, whatever range
 * the user picked, so the departure cost stops following the scenario range.
 */
export function wsdotDepartureDates (config: WSDOTReportConfig): string[] {
  const dates = new Set<string>()
  for (const date of wsdotReportDates(config)) {
    const previous = new Date(date.valueOf())
    previous.setDate(previous.getDate() - 1)
    dates.add(fmtDate(previous))
    dates.add(fmtDate(date))
  }
  return [...dates].sort()
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
  const configCopy = {
    ...config,
    routeHourCompatMode: true,
    includeFlexAreas: config.includeFlexAreas ?? false,
    departureDates: config.departureDates ?? wsdotDepartureDates(config),
  }

  // Departures are folded into per-hour counters as they stream rather than
  // accumulated. The report reads only counts, and holding every departure is
  // what put a statewide run over the Worker's memory limit. Stops, routes and
  // feed versions are still accumulated: the stop table is built from them,
  // and so is the stops-and-routes report layered on top of this one.
  const frequency = new WSDOTFrequencyAggregator(wsdotReportDates(config))
  const stops = new WSDOTStopCollector(config.aggregateLayer)

  // Nothing downstream of here reads a departure. The browser shows two
  // numbers from them, so the numbers are what it gets: the tuples are folded
  // and dropped rather than forwarded, keeping several million of them off the
  // wire and out of the browser's heap.
  let departures = 0
  const stopsWithDepartures = new Set<number>()
  const departureSummary = () => ({ departures, stopsWithDepartures: stopsWithDepartures.size })

  // Every event bound for the client goes through here, including the ones the
  // analysis stage emits after the scenario phases are done. Attaching the
  // totals at each call site instead would leave those events without them,
  // and the loading modal reads the running figures off whatever it last
  // received.
  const clientSender: WSDOTProgressSink = {
    onProgress: progress => scenarioDataSender.onProgress({
      ...withoutDepartures(progress),
      departureSummary: departureSummary(),
    }),
  }

  const receiver = new ScenarioDataReceiver({
    onProgress: (progress) => {
      // Folded off the progress events rather than in place of accumulation,
      // so the report is built from the same records whether or not the whole
      // stops are being kept alongside for the caller.
      const batch = progress.partialData?.stops
      if (batch) {
        stops.add(batch)
      }
      clientSender.onProgress(progress)
    },
    onError: error => scenarioDataSender.onError(error),
  }, {
    onStopDepartures: (batch) => {
      frequency.addDepartures(batch)
      departures += batch.length
      for (const departure of batch) {
        stopsWithDepartures.add(StopDepartureTuple.stopId(departure))
      }
    },
    dropStops: !opts.retainScenarioEntities,
    dropRouteGeometry: !opts.retainScenarioEntities,
  })

  // Send config as initial extra data
  clientSender.onProgress({
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
  clientSender.onProgress({
    isLoading: true,
    currentStage: 'extra',
    currentStageMessage: 'Running WSDOT frequency analysis...'
  })

  let wsdotResult: WSDOTReport = { stops: [], levelStops: {}, levelLayers: {}, bboxIntersection: [] }
  let failure: { error: unknown } | undefined
  try {
    const wsdotFetcher = new WSDOTReportFetcher(configCopy, scenarioData, stops, frequency, client, clientSender)
    wsdotResult = await wsdotFetcher.fetch()
  } catch (e) {
    console.error('WSDOT analysis error:', e)
    failure = { error: e }
    scenarioDataSender.onError({ message: `WSDOT analysis error: ${e}` })
  }

  // Completion carries the totals too, so the figures do not blank out on the
  // last event a consumer sees.
  clientSender.onProgress({ isLoading: false, currentStage: 'complete' })
  await writer.close()

  if (failure) {
    // The stream already carries the error and has been closed, so a browser
    // consumer is unaffected. This is for the in-process callers that build a
    // report out of the return value: an empty WSDOTReport is structurally
    // valid and would export as a plausible report of a total service desert.
    throw failure.error
  }

  return { scenarioData, wsdotResult }
}

export class WSDOTReportFetcher {
  private config: WSDOTReportConfig
  private scenarioData: ScenarioData
  private stops: WSDOTStopCollector
  private frequency: WSDOTFrequencyAggregator
  private client: GraphQLClient
  private progressSender: WSDOTProgressSink

  constructor (
    config: WSDOTReportConfig,
    data: ScenarioData,
    stops: WSDOTStopCollector,
    frequency: WSDOTFrequencyAggregator,
    client: GraphQLClient,
    progressSender: WSDOTProgressSink
  ) {
    this.config = config
    this.scenarioData = data
    this.stops = stops
    this.frequency = frequency
    this.client = client
    this.progressSender = progressSender
  }

  async fetch (): Promise<WSDOTReport> {
    console.log('Starting WSDOT frequency analysis...')

    const labels = this.frequencyLabels()
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
    // Stops that arrived without geometry are skipped, as they were before.
    const stops: WSDOTStopResult[] = []

    for (const stop of this.stops.all) {
      if (stop.lat === null || stop.lon === null) {
        continue
      }
      const stopId = stop.id
      stops.push({
        feedOnestopId: stop.feedOnestopId,
        feedVersionSha1: stop.feedVersionSha1,
        stateName: stop.stateName,
        stopId: stop.gtfsStopId,
        stopName: stop.stopName,
        stopLat: stop.lat,
        stopLon: stop.lon,
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

  // Numeric id -> GTFS id for every stop and route the scenario fetched. These
  // are the domain the frequency maps are built over, so a stop with no
  // service still appears with empty counters.
  private frequencyLabels (): FrequencyLabels {
    const routeGtfsIds = new Map<number, string>()
    for (const route of this.scenarioData.routes) {
      routeGtfsIds.set(route.id, route.route_id)
    }
    return { stopGtfsIds: this.stops.gtfsIds(), routeGtfsIds }
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

// Strips the departure payload from an event bound for the client, along with
// the trip-id sidecar that only names departures. Returns the event unchanged
// when it carries neither, so the common case allocates nothing.
function withoutDepartures (progress: ScenarioProgress): ScenarioProgress {
  const partial = progress.partialData
  if (!partial?.stopDepartures && !partial?.tripIdStrings) {
    return progress
  }
  const { stopDepartures: _departures, tripIdStrings: _tripIds, ...rest } = partial
  return { ...progress, partialData: rest }
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
