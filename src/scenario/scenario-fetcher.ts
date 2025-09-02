import {
  StopDepartureQueryVars,
  stopDepartureQuery,
  type StopDeparture,
  type StopTime } from '../departure'
import {
  type StopGql,
  stopQuery,
} from '../stop'
import { feedVersionQuery, type FeedGql, type FeedVersion } from '../feed-version'
import {
  type RouteGql,
  routeQuery,
} from '../route'
import { TaskQueue } from '../task-queue'
import type { GraphQLClient } from '../graphql'
import type { Bbox } from '../geom'
import type {
  ScenarioData,
  ScenarioConfig
} from './scenario'
import { StopDepartureCache } from '~/src/departure-cache'

/**
 * Task definitions for the scenario fetcher
 */
export interface StopFetchTask {
  after: number
  feedOnestopId: string
  feedVersionSha1: string
}

export interface RouteFetchTask {
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
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'complete' | 'ready'
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
      return await this.fetchMain()
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

    // Done
    this.callbacks.onComplete?.()
    this.updateProgress('complete', false)
    console.log(`🎉 Scenario complete`)
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions (): Promise<FeedVersion[]> {
    const variables = { where: { bbox: convertBbox(this.config.bbox) } }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedVersions = (response.data?.feeds || []).map(feed => feed.feed_state.feed_version)
    this.updateProgressWithNewData('feed-versions', true, { stops: [], routes: [], feedVersions: feedVersions, stopDepartures: [] })
    return feedVersions
  }

  // Fetch stops from GraphQL API
  private async fetchStops (task: StopFetchTask): Promise<void> {
    const b = (this.config.bbox == null ? null : convertBbox(this.config.bbox))
    const geoIds = this.config.geographyIds || []
    const variables = {
      after: task.after,
      limit: this.stopLimit,
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
    this.updateProgressWithNewData('stops', true, { stops: stopData, routes: [], feedVersions: [], stopDepartures: [] })

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
    this.updateProgressWithNewData('routes', true, { stops: [], routes: routeData, feedVersions: [], stopDepartures: [] })
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
    this.updateProgressWithNewData('schedules', true, { stops: [], routes: [], feedVersions: [], stopDepartures })
  }

  private async updateProgress (stage: ScenarioProgress['currentStage'], loading: boolean) {
    this.callbacks.onProgress?.({
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage
    })
  }

  private async updateProgressWithNewData (stage: ScenarioProgress['currentStage'], loading: boolean, newData: ScenarioProgress['partialData']) {
    this.callbacks.onProgress?.({
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage,
      partialData: newData
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
