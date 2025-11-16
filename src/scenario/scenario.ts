import { format } from 'date-fns'
import bbox from '@turf/bbox'
import {
  GenericStreamReceiver,
  GenericStreamSender,
  multiplexStream,
  requestStream,
  TaskQueue,
  type dow,
  type Bbox,
  type GraphQLClient,
  convertBbox,
  chunkArray
} from '~/src/core'
import {
  StopDepartureCache,
  feedVersionQuery,
  routeQuery,
  stopDepartureQuery,
  stopTimeQuery,
  stopQuery,
  type FeedGql,
  type FeedVersion,
  type RouteGql,
  type StopDeparture,
  type StopGql,
  type StopTime
} from '~/src/tl'
import { geographyLayerQuery } from '~/src/tl/census'

// Constants for progress updates
const PROGRESS_LIMIT_STOPS = 1000
const PROGRESS_LIMIT_ROUTES = 10
const PROGRESS_LIMIT_STOP_DEPARTURES = 100_000_000

/**
 * Configuration for scenario fetching
 */

export interface ScenarioConfig {
  reportName: string
  bbox?: Bbox
  startDate?: Date
  endDate?: Date
  geographyIds?: number[]
  stopLimit?: number
  aggregateLayer?: string
  departureMode?: 'all' | 'departures'
  geoDatasetName: string
}

export interface ScenarioFilter {
  startTime?: Date
  endTime?: Date
  selectedRouteTypes: number[]
  selectedDays: dow[]
  selectedAgencies: string[]
  selectedDayOfWeekMode: string
  selectedTimeOfDayMode: string
  frequencyUnder?: number
  frequencyOver?: number
  frequencyUnderEnabled: boolean
  frequencyOverEnabled: boolean
}

/**
 * Scenario results
 */
export interface ScenarioData {
  routes: RouteGql[]
  stops: StopGql[]
  feedVersions: FeedVersion[]
  stopDepartureCache: StopDepartureCache
}

export function getSelectedDateRange (config: ScenarioConfig): Date[] {
  const sd = new Date((config.startDate || new Date()).valueOf())
  const ed = new Date((config.endDate || new Date()).valueOf())
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  // console.log(`Selected date range: ${sd.toISOString()} to ${ed.toISOString()}: dates ${dates.map(d => d.toISOString()).join(', ')}`)
  return dates
}

/**
 * Task definitions for the scenario fetcher
 */
interface StopFetchTask {
  after: number
  feedOnestopId: string
  feedVersionSha1: string
}

interface RouteFetchTask {
  feedOnestopId: string
  feedVersionSha1: string
  ids: number[]
}

/**
 * Callback interface for scenario fetching events
 */
export interface ScenarioCallbacks {
  onProgress?: (progress: ScenarioProgress) => void
  onComplete?: () => void
  onError?: (error: any) => void
}

/**
 * Progress information for scenario fetching
 */
export interface ScenarioProgress {
  isLoading: boolean
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'complete' | 'ready' | 'extra'
  currentStageMessage?: string
  stopDepartureProgress?: { total: number, completed: number }
  feedVersionProgress?: { total: number, completed: number }
  error?: any
  // Partial data available during progress
  partialData?: {
    stops: StopGql[]
    routes: RouteGql[]
    feedVersions: FeedVersion[]
    stopDepartures: StopDepartureTuple[]
  }
  extraData?: any
  config?: any
}

// Define the tuple type with named fields
export type StopDepartureTuple = readonly [
  stop_id: number,
  departure_date: string,
  departure_time: string,
  trip_id: number,
  trip_direction_id: number,
  trip_route_id: number,
  trip_trip_id: string
]

// Helper functions for working with the tuple
export const StopDepartureTuple = {
  create: (
    stop_id: number,
    departure_date: string,
    departure_time: string,
    trip_id: number,
    trip_direction_id: number,
    trip_route_id: number,
    trip_trip_id: string,
  ): StopDepartureTuple => [stop_id, departure_date, departure_time, trip_id, trip_direction_id, trip_route_id, trip_trip_id],
  fromStopTime: (stopId: number, departureDate: string, stopDeparture: StopTime) => StopDepartureTuple.create(
    stopId,
    departureDate,
    stopDeparture.departure_time,
    stopDeparture.trip.id,
    stopDeparture.trip.direction_id,
    stopDeparture.trip.route.id,
    stopDeparture.trip.trip_id,
  ),
  stopId: (tuple: StopDepartureTuple) => tuple[0],
  departureDate: (tuple: StopDepartureTuple) => tuple[1],
  departureTime: (tuple: StopDepartureTuple) => tuple[2],
  tripId: (tuple: StopDepartureTuple) => tuple[3],
  tripDirectionId: (tuple: StopDepartureTuple) => tuple[4],
  tripRouteId: (tuple: StopDepartureTuple) => tuple[5],
  tripTripId: (tuple: StopDepartureTuple) => tuple[6],
}

// ============================================================================
// SCENARIO MAIN CLASS
// ============================================================================

export class StopDepartureQueryVars {
  ids: number[] = []
  monday: string = ''
  tuesday: string = ''
  wednesday: string = ''
  thursday: string = ''
  friday: string = ''
  saturday: string = ''
  sunday: string = ''
  include_monday: boolean = false
  include_tuesday: boolean = false
  include_wednesday: boolean = false
  include_thursday: boolean = false
  include_friday: boolean = false
  include_saturday: boolean = false
  include_sunday: boolean = false

  get (dow: string): string {
    switch (dow) {
      case 'monday':
        return this.monday
      case 'tuesday':
        return this.tuesday
      case 'wednesday':
        return this.wednesday
      case 'thursday':
        return this.thursday
      case 'friday':
        return this.friday
      case 'saturday':
        return this.saturday
      case 'sunday':
        return this.sunday
    }
    return ''
  }

  setDay (d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0:
        this.sunday = format(d, dateFmt)
        this.include_sunday = true
        break
      case 1:
        this.monday = format(d, dateFmt)
        this.include_monday = true
        break
      case 2:
        this.tuesday = format(d, dateFmt)
        this.include_tuesday = true
        break
      case 3:
        this.wednesday = format(d, dateFmt)
        this.include_wednesday = true
        break
      case 4:
        this.thursday = format(d, dateFmt)
        this.include_thursday = true
        break
      case 5:
        this.friday = format(d, dateFmt)
        this.include_friday = true
        break
      case 6:
        this.saturday = format(d, dateFmt)
        this.include_saturday = true
        break
    }
  }
}

export async function runScenarioFetcher (controller: ReadableStreamDefaultController, config: ScenarioConfig, client: GraphQLClient): Promise<ScenarioData> {
  // Create a multiplex stream that writes to both the response and a new output stream
  const { inputStream, outputStream } = multiplexStream(requestStream(controller))
  const writer = inputStream.getWriter()

  // Configure fetcher/sender
  const scenarioDataSender = new ScenarioStreamSender(writer)
  const fetcher = new ScenarioFetcher(config, client, scenarioDataSender)

  // Send config as initial extra data
  scenarioDataSender.onProgress({
    isLoading: true,
    currentStage: 'ready',
    currentStageMessage: 'Starting scenario fetcher',
    config: config,
  })

  // Configure client/receiver
  const receiver = new ScenarioDataReceiver()
  const scenarioDataClient = new ScenarioStreamReceiver()
  const scenarioClientProgress = scenarioDataClient.processStream(outputStream, receiver)

  // Start the fetch process
  await fetcher.fetch()

  // Final complete - close the multiplexed stream
  scenarioDataSender.onComplete()
  writer.close()

  // Ensure all scenario client progress has been processed
  await scenarioClientProgress

  // Return the accumulated data
  return receiver.getCurrentData()
}

export class ScenarioFetcher {
  private config: ScenarioConfig
  private callbacks: ScenarioCallbacks
  private client: GraphQLClient

  // Internal state
  private stopLimit = 1000
  private stopTimeBatchSize = 100
  private maxConcurrentRequests = 8

  // Dynamic progress getters
  private get feedVersionProgress (): { total: number, completed: number } {
    const stopProgress = this.stopFetchQueue.getProgress()
    const routeProgress = this.routeFetchQueue.getProgress()
    return {
      total: stopProgress.total + routeProgress.total,
      completed: stopProgress.completed + routeProgress.completed
    }
  }

  private get stopDepartureProgress (): { total: number, completed: number } {
    return this.stopDepartureQueue.getProgress()
  }

  // Task queues
  private stopFetchQueue: TaskQueue<StopFetchTask>
  private routeFetchQueue: TaskQueue<RouteFetchTask>
  private stopDepartureQueue: TaskQueue<StopDepartureQueryVars>

  // Internal result bookkeeping
  private fetchedRouteIds: Set<number> = new Set()

  constructor (
    config: ScenarioConfig,
    client: GraphQLClient,
    callbacks: ScenarioCallbacks = {}
  ) {
    this.config = config
    this.callbacks = callbacks
    this.client = client
    this.stopLimit = config.stopLimit ?? 1000

    // Initialize task queues
    this.stopFetchQueue = new TaskQueue<StopFetchTask>(
      this.maxConcurrentRequests,
      task => this.fetchStops(task), {
        onError: error => this.callbacks.onError?.(error)
      }
    )

    this.routeFetchQueue = new TaskQueue<RouteFetchTask>(
      this.maxConcurrentRequests,
      task => this.fetchRoutes(task), {
        onError: error => this.callbacks.onError?.(error)
      }
    )

    this.stopDepartureQueue = new TaskQueue<StopDepartureQueryVars>(
      this.maxConcurrentRequests,
      task => this.fetchStopDepartures(task), {
        onProgress: () => { this.updateProgress('schedules', true) },
        onError: error => this.callbacks.onError?.(error)
      }
    )
  }

  async fetch () {
    try {
      await this.fetchMain()
    } catch (error) {
      this.callbacks.onError?.(error)
      throw error
    }
  }

  // Start the scenario fetching process
  private async fetchMain () {
    // FIRST STAGE: Fetch active feed versions in the area
    const feedVersions = await this.fetchFeedVersions()
    console.log(`Found ${feedVersions.length} feed versions`)
    for (const fv of feedVersions) {
      console.log(`    ${fv.feed?.onestop_id} ${fv.sha1}`)
    }
    for (const fv of feedVersions) {
      this.stopFetchQueue.enqueueOne({
        after: 0,
        feedOnestopId: fv.feed.onestop_id,
        feedVersionSha1: fv.sha1
      })
    }

    // Wait for all stop fetching to complete
    this.stopFetchQueue.run()
    this.routeFetchQueue.run()
    this.stopDepartureQueue.run()
    await this.stopFetchQueue.wait()
    await this.routeFetchQueue.wait()
    await this.stopDepartureQueue.wait()

    // Done - send completion progress event (client will handle onComplete)
    this.updateProgress('complete', false)
    console.log(`🎉 Scenario complete`)
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions (): Promise<FeedVersion[]> {
    let searchBbox = this.config.bbox
    // If using one or more administrative boundaries, compute a bbox around them
    if (this.config.geographyIds && this.config.geographyIds.length > 0) {
      // First get the geometry for the administrative boundaries
      const geogResponse = await this.client.query<{ census_datasets: { geographies: { geometry: GeoJSON.MultiPolygon }[] }[] }>(
        geographyLayerQuery,
        {
          geography_ids: this.config.geographyIds,
          include_geographies: true,
          dataset_name: this.config.geoDatasetName
        }
      )

      // Combine all geometries into a FeatureCollection
      const features = geogResponse.data?.census_datasets?.[0]?.geographies?.map(g => ({
        type: 'Feature' as const,
        geometry: g.geometry,
        properties: {}
      })) || []

      if (features.length > 0) {
        const fc = {
          type: 'FeatureCollection' as const,
          features
        }

        // Calculate bbox that contains all administrative boundaries
        const [minX, minY, maxX, maxY] = bbox(fc)
        searchBbox = {
          sw: { lon: minX, lat: minY },
          ne: { lon: maxX, lat: maxY },
          valid: true
        }
      } else {
        console.warn('No features found in census datasets response')
      }
    }

    // Use the bbox (either user-specified or computed around admin boundaries) to query feed versions
    const bboxForQuery = convertBbox(searchBbox)
    const variables = { where: { bbox: bboxForQuery } }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedVersions = (response.data?.feeds || []).map(feed => feed.feed_state.feed_version)

    this.updateProgress('feed-versions', true, { stops: [], routes: [], feedVersions, stopDepartures: [] })

    return feedVersions
  }

  // Fetch stops from GraphQL API
  private async fetchStops (task: StopFetchTask): Promise<void> {
    // If we have geography IDs, use them and no bbox
    // If we don't, use the bbox from the config
    const geoIds = this.config.geographyIds || []
    const b = geoIds.length > 0 ? null : convertBbox(this.config.bbox)
    const variables = {
      after: task.after,
      limit: this.stopLimit,
      layer_name: this.config.aggregateLayer,
      dataset_name: this.config.geoDatasetName,
      where: {
        location_type: 0,
        feed_version_sha1: task.feedVersionSha1,
        location: {
          bbox: geoIds.length > 0 ? null : b,
          geography_ids: geoIds.length > 0 ? geoIds : null,
        }
      }
    }
    const response = await this.client.query<{ stops: StopGql[] }>(stopQuery, variables)
    const stopData: StopGql[] = response.data?.stops || []
    console.log(`Fetched ${stopData.length} stops from ${task.feedOnestopId}:${task.feedVersionSha1}`)

    // Send progress updates in batches using the generic helper function
    for (const stopBatch of chunkArray(stopData, PROGRESS_LIMIT_STOPS)) {
      this.updateProgress('stops', true, { stops: stopBatch, routes: [], feedVersions: [], stopDepartures: [] })
    }

    // Extract route IDs and fetch routes
    const routeIds: Set<number> = new Set()
    for (const stop of stopData) {
      for (const rs of stop.route_stops || []) {
        if (this.fetchedRouteIds.has(rs.route?.id)) {
          continue
        }
        routeIds.add(rs.route?.id)
        this.fetchedRouteIds.add(rs.route?.id) // add pre-emptively...
      }
    }
    this.routeFetchQueue.enqueueOne({ feedOnestopId: task.feedOnestopId, feedVersionSha1: task.feedVersionSha1, ids: [...routeIds] })

    // Enqueue stop departure fetching
    const stopIds = stopData.map(s => s.id)
    const dates = getSelectedDateRange(this.config)
    const weekSize = 7
    // Build all tasks first
    for (let sid = 0; sid < stopIds.length; sid += this.stopTimeBatchSize) {
      for (let i = 0; i < dates.length; i += weekSize) {
        const w = new StopDepartureQueryVars()
        w.ids = stopIds.slice(sid, sid + this.stopTimeBatchSize)
        for (const d of dates.slice(i, i + weekSize)) {
          w.setDay(d)
        }
        this.stopDepartureQueue.enqueueOne(w)
      }
    }

    // Continue fetching more stops only if we got a full batch
    // If we got fewer than the limit, we've reached the end
    const lastStopId = stopIds[stopIds.length - 1]
    if (stopData.length >= this.stopLimit && stopIds.length > 0 && lastStopId !== undefined) {
      this.stopFetchQueue.enqueueOne({
        after: lastStopId,
        feedOnestopId: task.feedOnestopId,
        feedVersionSha1: task.feedVersionSha1
      })
    }
  }

  // Fetch routes from GraphQL API
  private async fetchRoutes (task: RouteFetchTask): Promise<void> {
    if (task.ids.length === 0) {
      return
    }
    const response = await this.client.query<{ routes: RouteGql[] }>(routeQuery, { ids: task.ids })
    const routeData = response.data?.routes || []
    for (const route of routeData) {
      this.fetchedRouteIds.add(route.id)
    }

    // Send progress updates in batches using the generic helper function
    for (const routeBatch of chunkArray(routeData, PROGRESS_LIMIT_ROUTES)) {
      this.updateProgress('routes', true, { stops: [], routes: routeBatch, feedVersions: [], stopDepartures: [] })
    }

    console.log(`Fetched ${routeData.length} routes from ${task.feedOnestopId}:${task.feedVersionSha1}`)
  }

  // Fetch stop departures from GraphQL API
  private async fetchStopDepartures (task: StopDepartureQueryVars): Promise<void> {
    if (task.ids.length === 0) {
      return
    }
    const dowDateStringLower = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const fetchDates = dowDateStringLower.filter(s => task.get(s)).map(s => `${s.slice(0, 2)}:${task.get(s)}`).join(', ')
    console.log(`Fetching stop departures for ${task.ids.length} stops on dates ${fetchDates}`)
    const q = this.config.departureMode === 'departures' ? stopDepartureQuery : stopTimeQuery
    const response = await this.client.query<{ stops: StopDeparture[] }>(q, task)
    // Map into simpler format for wire format
    const stopDepartures: StopDepartureTuple[] = []
    for (const stop of response.data?.stops || []) {
      for (const dow of dowDateStringLower) {
        const dowDate = task.get(dow)
        if (!dowDate) {
          continue
        }
        const stopTimes = (() => {
          switch (dow) {
            case 'monday':
              return stop.monday || []
            case 'tuesday':
              return stop.tuesday || []
            case 'wednesday':
              return stop.wednesday || []
            case 'thursday':
              return stop.thursday || []
            case 'friday':
              return stop.friday || []
            case 'saturday':
              return stop.saturday || []
            case 'sunday':
              return stop.sunday || []
            default:
              return []
          }
        })()
        stopDepartures.push(
          ...stopTimes.map((st: StopTime) => StopDepartureTuple.fromStopTime(stop.id, dowDate, st))
        )
      }
    }

    // Send progress updates in batches using the generic helper function
    for (const stopDepartureBatch of chunkArray(stopDepartures, PROGRESS_LIMIT_STOP_DEPARTURES)) {
      this.updateProgress('schedules', true, { stops: [], routes: [], feedVersions: [], stopDepartures: stopDepartureBatch })
    }
  }

  private async updateProgress (stage: ScenarioProgress['currentStage'], loading: boolean, newData?: ScenarioProgress['partialData']) {
    this.callbacks.onProgress?.({
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage,
      partialData: newData,
    })
  }
}

// ============================================================================
// SCENARIO DATA RECEIVER - Core accumulation logic
// ============================================================================

/**
 * Receives progress events and accumulates ScenarioData
 * This is the core logic used by both in-process and streaming scenarios
 */
export class ScenarioDataReceiver {
  private accumulatedData: ScenarioData
  private callbacks: ScenarioCallbacks

  constructor (callbacks: ScenarioCallbacks = {}) {
    this.callbacks = callbacks
    this.accumulatedData = {
      stops: [],
      routes: [],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
    }
  }

  /**
   * Handle a progress event from ScenarioFetcher
   */
  onProgress (progress: ScenarioProgress): void {
    // console.log('ScenarioDataReceiver onProgress', progress)
    // If progress contains partial data, accumulate it
    if (progress.partialData) {
      // Append new stops
      this.accumulatedData.stops.push(...progress.partialData.stops)

      // Append new routes
      this.accumulatedData.routes.push(...progress.partialData.routes)

      // Append new feed versions
      this.accumulatedData.feedVersions.push(...progress.partialData.feedVersions)

      // Append new stop departure events
      for (const event of progress.partialData.stopDepartures) {
        const st: StopTime = {
          departure_time: StopDepartureTuple.departureTime(event),
          trip: {
            id: StopDepartureTuple.tripId(event),
            direction_id: StopDepartureTuple.tripDirectionId(event),
            trip_id: StopDepartureTuple.tripTripId(event),
            route: {
              id: StopDepartureTuple.tripRouteId(event)
            }
          }
        }
        // const stopId = StopDepartureTuple.stopId(event)
        // const departureDate = StopDepartureTuple.departureDate(event)
        this.accumulatedData.stopDepartureCache.add(
          StopDepartureTuple.stopId(event),
          StopDepartureTuple.departureDate(event),
          [st],
        )
      }
    }

    // Forward progress to callback
    this.callbacks.onProgress?.(progress)
  }

  /**
   * Handle completion from ScenarioFetcher
   */
  onComplete (): void {
    this.callbacks.onComplete?.()
  }

  /**
   * Handle error from ScenarioFetcher
   */
  onError (error: any): void {
    this.callbacks.onError?.(error)
  }

  /**
   * Get the current accumulated data
   */
  getCurrentData (): ScenarioData {
    return { ...this.accumulatedData }
  }
}

// ============================================================================
// SCENARIO-SPECIFIC IMPLEMENTATIONS (backward compatibility)
// ============================================================================

/**
 * ScenarioCallbacks that write progress data to a stream
 */
export class ScenarioStreamSender extends GenericStreamSender<ScenarioProgress> implements ScenarioCallbacks {}

/**
 * Streaming client processes readable streams and uses ScenarioDataReceiver
 */
export class ScenarioStreamReceiver extends GenericStreamReceiver<ScenarioProgress, ScenarioData> {}

//////////////////////
// Moved from core
//////////////////////
