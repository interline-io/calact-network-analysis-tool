import { format } from 'date-fns'
import {
  StopDepartureCache,
  feedVersionQuery,
  newRouteHeadwaySummary,
  routeQuery,
  routeSetDerived,
  stopDepartureQuery,
  StopDepartureQueryVars,
  stopQuery,
  stopSetDerived,
  type Agency,
  type FeedGql,
  type FeedVersion,
  type Route,
  type RouteGql,
  type Stop,
  type StopDeparture,
  type StopGql,
  type StopTime
} from '~/src/tl'
import {
  cannedBboxes,
  GenericStreamReceiver,
  GenericStreamSender,
  getCurrentDate,
  getDateOneWeekLater,
  multiplexStream,
  parseDate,
  requestStream,
  routeTypes,
  TaskQueue,
  type dow,
  parseBbox,
  type Bbox,
  type GraphQLClient
} from '~/src/core'

export function ScenarioConfigFromBboxName (bboxname: string): ScenarioConfig {
  return {
    bbox: parseBbox(cannedBboxes.get(bboxname)!.bboxString),
    scheduleEnabled: true,
    startDate: parseDate(getCurrentDate()),
    endDate: parseDate(getDateOneWeekLater()),
    geographyIds: [],
    stopLimit: 1000,
    maxConcurrentDepartures: 8
  }
}

/**
 * Configuration for scenario fetching
 */

export interface ScenarioConfig {
  bbox?: Bbox
  scheduleEnabled: boolean
  startDate?: Date
  endDate?: Date
  geographyIds?: number[]
  stopLimit?: number
  aggregateLayer?: string
  maxConcurrentDepartures?: number
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

export interface ScenarioFilterResult {
  routes: Route[]
  stops: Stop[]
  agencies: Agency[]
  stopDepartureCache: StopDepartureCache
  feedVersions: FeedVersion[]
}

export function applyScenarioResultFilter (
  data: ScenarioData,
  config: ScenarioConfig,
  filter: ScenarioFilter
): ScenarioFilterResult {
  const sdCache = data.stopDepartureCache
  const selectedDateRangeValue = getSelectedDateRange(config)
  const selectedDayOfWeekModeValue = filter.selectedDayOfWeekMode || ''
  const selectedDaysValue = filter.selectedDays || []
  const selectedRouteTypesValue = filter.selectedRouteTypes || []
  const selectedAgenciesValue = filter.selectedAgencies || []
  const startTimeValue = filter.startTime ? format(filter.startTime, 'HH:mm:ss') : '00:00:00'
  const endTimeValue = filter.endTime ? format(filter.endTime, 'HH:mm:ss') : '24:00:00'
  const frequencyUnderValue = (filter.frequencyUnderEnabled ? filter.frequencyUnder : -1) || -1
  const frequencyOverValue = (filter.frequencyOverEnabled ? filter.frequencyOver : -1) || -1
  ///////////

  // Apply route filters
  const routeFeatures = data.routes.map((routeGql): Route => {
    const route: Route = {
      ...routeGql,
      route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
      agency_name: routeGql.agency?.agency_name || 'Unknown',
      route_mode: routeTypes.get(routeGql.route_type) || 'Unknown',
      marked: true,
      average_frequency: null,
      fastest_frequency: null,
      slowest_frequency: null,
      headways: newRouteHeadwaySummary(),
      __typename: 'Route', // backwards compat
    }
    routeSetDerived(
      route,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      sdCache,
    )
    return route
  })
  const markedRoutes = new Set(routeFeatures.filter(r => r.marked).map(r => r.id))

  // Apply stop filters
  const stopFeatures = data.stops.map((stopGql): Stop => {
    const stop: Stop = {
      ...stopGql,
      marked: true,
      visits: null,
      __typename: 'Stop', // backwards compat
    }
    stopSetDerived(
      stop,
      selectedDaysValue,
      selectedDayOfWeekModeValue,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      markedRoutes,
      sdCache
    )
    return stop
  })
  const _markedStops = new Set(stopFeatures.filter(s => s.marked).map(s => s.id))

  // Apply agency filters
  const agencyData = new Map()
  for (const stop of stopFeatures) {
    for (const rstop of stop.route_stops || []) {
      const agency = rstop.route.agency
      const aid = agency?.agency_id
      if (!aid) {
        continue // no valid agency listed for this stop?
      }
      const adata = agencyData.get(aid) || {
        id: aid,
        routes: new Set(),
        routes_modes: new Set(),
        stops: new Set(),
        agency: agency,
      }
      adata.routes.add(rstop.route.id)
      adata.routes_modes.add(rstop.route.route_type)
      adata.stops.add(stop.id)
      agencyData.set(aid, adata)
    }
  }
  const markedAgencies: Set<number> = new Set()
  stopFeatures.filter(s => s.marked).forEach((s) => {
    for (const rstop of s.route_stops || []) {
      markedAgencies.add(rstop.route.agency?.id)
    }
  })
  routeFeatures.filter(s => s.marked).forEach((s) => {
    markedAgencies.add(s.agency?.id)
  })
  const agencyDataValues = [...agencyData.values()]
  const agencyFeatures: Agency[] = agencyDataValues.map((adata): Agency => {
    const agency = adata.agency as Agency
    return {
      marked: markedAgencies.has(agency.id),
      routes_count: adata.routes.size, // adata.routes.intersection(markedRoutes).size,
      routes_modes: [...adata.routes_modes].map(r => (routeTypes.get(r) || 'Unknown')).join(', '),
      stops_count: adata.stops.size, // adata.stops.intersection(markedStops).size,
      id: agency.id,
      agency_id: agency.agency_id,
      agency_name: agency.agency_name,
      agency_email: agency.agency_email,
      agency_fare_url: agency.agency_fare_url,
      agency_lang: agency.agency_lang,
      agency_phone: agency.agency_phone,
      agency_timezone: agency.agency_timezone,
      __typename: 'Agency', // backwards compat
    }
  })

  ///////////
  const result: ScenarioFilterResult = {
    routes: routeFeatures,
    stops: stopFeatures,
    agencies: agencyFeatures,
    feedVersions: [],
    stopDepartureCache: sdCache,
  }
  return result
}

function getSelectedDateRange (config: ScenarioConfig): Date[] {
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
}

// Define the tuple type with named fields
export type StopDepartureTuple = readonly [
  stop_id: number,
  departure_date: string,
  departure_time: string,
  trip_id: number,
  trip_direction_id: number,
  trip_route_id: number
]

// Helper functions for working with the tuple
export const StopDepartureTuple = {
  create: (
    stop_id: number,
    departure_date: string,
    departure_time: string,
    trip_id: number,
    trip_direction_id: number,
    trip_route_id: number
  ): StopDepartureTuple => [stop_id, departure_date, departure_time, trip_id, trip_direction_id, trip_route_id],
  fromStopTime: (stopId: number, departureDate: string, stopDeparture: StopTime) => StopDepartureTuple.create(
    stopId,
    departureDate,
    stopDeparture.departure_time,
    stopDeparture.trip.id,
    stopDeparture.trip.direction_id,
    stopDeparture.trip.route.id
  ),
  stopId: (tuple: StopDepartureTuple) => tuple[0],
  departureDate: (tuple: StopDepartureTuple) => tuple[1],
  departureTime: (tuple: StopDepartureTuple) => tuple[2],
  tripId: (tuple: StopDepartureTuple) => tuple[3],
  tripDirectionId: (tuple: StopDepartureTuple) => tuple[4],
  tripRouteId: (tuple: StopDepartureTuple) => tuple[5]
}

// ============================================================================
// SCENARIO MAIN CLASS
// ============================================================================

export async function runScenarioFetcher (controller: ReadableStreamDefaultController, config: ScenarioConfig, client: GraphQLClient): Promise<ScenarioData> {
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
    this.maxConcurrentRequests = config.maxConcurrentDepartures ?? 8

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
    const variables = { where: { bbox: convertBbox(this.config.bbox) } }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedVersions = (response.data?.feeds || []).map(feed => feed.feed_state.feed_version)
    this.updateProgress('feed-versions', true, { stops: [], routes: [], feedVersions: feedVersions, stopDepartures: [] })
    return feedVersions
  }

  // Fetch stops from GraphQL API
  private async fetchStops (task: StopFetchTask): Promise<void> {
    const b = (this.config.bbox == null ? null : convertBbox(this.config.bbox))
    const geoIds = this.config.geographyIds || []
    const variables = {
      after: task.after,
      limit: this.stopLimit,
      layer_name: this.config.aggregateLayer,
      dataset_name: 'tiger2024', // hardcoded for now
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

    // Send progress update with only the NEW stops
    this.updateProgress('stops', true, { stops: stopData, routes: [], feedVersions: [], stopDepartures: [] })

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
    if (stopData.length >= this.stopLimit && stopIds.length > 0) {
      this.stopFetchQueue.enqueueOne({
        after: stopIds[stopIds.length - 1],
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
    this.updateProgress('routes', true, { stops: [], routes: routeData, feedVersions: [], stopDepartures: [] })
    console.log(`Fetched ${routeData.length} routes from ${task.feedOnestopId}:${task.feedVersionSha1}`)
  }

  // Fetch stop departures from GraphQL API
  private async fetchStopDepartures (task: StopDepartureQueryVars): Promise<void> {
    if (!this.config.scheduleEnabled || task.ids.length === 0) {
      return
    }
    const dowDateStringLower = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const fetchDates = dowDateStringLower.filter(s => task.get(s)).map(s => `${s.slice(0, 2)}:${task.get(s)}`).join(', ')
    console.log(`Fetching stop departures for ${task.ids.length} stops on dates ${fetchDates}`)
    const response = await this.client.query<{ stops: StopDeparture[] }>(stopDepartureQuery, task)
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
    this.updateProgress('schedules', true, { stops: [], routes: [], feedVersions: [], stopDepartures })
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
            route: {
              id: StopDepartureTuple.tripRouteId(event)
            }
          }
        }
        // const stopId = StopDepartureTuple.stopId(event)
        // const departureDate = StopDepartureTuple.departureDate(event)
        // console.log(`Adding stop departure for stop ${stopId} on ${st.departure_time} ${departureDate} trip ${st.trip.id}`)
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

function convertBbox (bbox: Bbox | undefined): any {
  return {
    min_lon: bbox ? bbox.sw.lon : null,
    min_lat: bbox ? bbox.sw.lat : null,
    max_lon: bbox ? bbox.ne.lon : null,
    max_lat: bbox ? bbox.ne.lat : null
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
