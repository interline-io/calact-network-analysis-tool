import { createWriteStream, type WriteStream } from 'fs'
import { gql } from 'graphql-tag'
import { format } from 'date-fns'
import {
  type StopDeparture,
  type StopTime,
  StopDepartureQueryVars,
  stopDepartureQuery
} from './departure'
import {
  type Stop,
  type StopGql,
  stopQuery,
  stopSetDerived
} from './stop'
import type { Agency } from './agency'
import {
  type Route,
  type RouteGql,
  routeSetDerived,
  routeQuery,
  newRouteHeadwaySummary
} from './route'
import { TaskQueue } from './task-queue'
import { BasicGraphQLClient, type GraphQLClient } from './graphql'
import { getCurrentDate, parseDate, getDateOneWeekLater } from './datetime'
import { StopDepartureCache } from '~/src/departure-cache'
import { cannedBboxes, type dow, routeTypes } from '~/src/constants'
import { parseBbox, type Bbox } from '~/src/geom'

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
 * Configuration for scenario fetching
 */
export interface ScenarioConfig {
  bbox?: Bbox
  scheduleEnabled: boolean
  startDate?: Date
  endDate?: Date
  geographyIds?: number[]
  stopLimit?: number
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
 * Result of scenario fetching
 */
export interface ScenarioData {
  routes: RouteGql[]
  stops: StopGql[]
  feedVersions: FeedVersion[]
  stopDepartureCache: StopDepartureCache
  isComplete: boolean
}

export interface ScenarioFilterResult {
  routes: Route[]
  stops: Stop[]
  agencies: Agency[]
  stopDepartureCache: StopDepartureCache
  isComplete: boolean
  feedVersions: FeedVersion[]
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
  }
}

/**
 * Callback interface for scenario fetching events
 */
export interface ScenarioCallbacks {
  onProgress?: (progress: ScenarioProgress) => void
  onComplete?: () => void
  onError?: (error: any) => void
}

// ============================================================================
// SCENARIO MAIN CLASS
// ============================================================================

export class ScenarioFetcher {
  private config: ScenarioConfig
  private callbacks: ScenarioCallbacks
  private client: GraphQLClient

  // Internal state
  private stopDepartureCache = new StopDepartureCache()
  private stopLimit = 1000
  private stopTimeBatchSize = 100
  private maxConcurrentDepartures = 8

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

  // Results
  private stopResults: StopGql[] = []
  private routeResults: RouteGql[] = []
  private feedVersions: FeedVersion[] = []

  constructor (
    config: ScenarioConfig,
    client: GraphQLClient,
    callbacks: ScenarioCallbacks = {}
  ) {
    this.config = config
    this.callbacks = callbacks
    this.client = client
    this.stopLimit = config.stopLimit ?? 1000
    this.maxConcurrentDepartures = config.maxConcurrentDepartures ?? 8

    // Initialize task queues
    this.stopFetchQueue = new TaskQueue<StopFetchTask>(
      this.maxConcurrentDepartures,
      task => this.fetchStops(task), {
        onError: error => this.callbacks.onError?.(error)
      }
    )

    this.routeFetchQueue = new TaskQueue<RouteFetchTask>(
      this.maxConcurrentDepartures,
      task => this.fetchRoutes(task), {
        onError: error => this.callbacks.onError?.(error)
      }
    )

    this.stopDepartureQueue = new TaskQueue<StopDepartureQueryVars>(
      this.maxConcurrentDepartures,
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
    // Reset state
    this.stopResults = []
    this.routeResults = []
    this.feedVersions = []
    this.stopDepartureCache = new StopDepartureCache()

    // FIRST STAGE: Fetch active feed versions in the area
    await this.wrapTimer('Feed version discovery', 'feed-versions', async () => {
      await this.fetchFeedVersions()
      console.log(`Found ${this.feedVersions.length} feed versions`)
      for (const fv of this.feedVersions) {
        console.log(`    ${fv.feed?.onestop_id} ${fv.sha1}`)
      }
    })

    // SECOND STAGE: Fetch stops for all feed versions
    await this.wrapTimer('Stop discovery', 'stops', async () => {
      // Enqueue stop fetch tasks
      for (const feedVersion of this.feedVersions) {
        this.stopFetchQueue.enqueueOne({
          after: 0,
          feedOnestopId: feedVersion.feed.onestop_id,
          feedVersionSha1: feedVersion.sha1
        })
      }
      // Wait for all stop fetching to complete
      await this.stopFetchQueue.wait()
      console.log(`Fetched ${this.stopResults.length} stops`)
    })

    // SECOND and a HALF STAGE: Send route updates
    await this.wrapTimer('Route updates', 'routes', async () => {
      // Wait for all route fetching to complete
      await this.routeFetchQueue.wait()
      console.log(`Fetched ${this.routeResults.length} routes`)
    })

    // THIRD STAGE: Wait for all stop departure queries to complete
    await this.wrapTimer('Schedule queries', 'schedules', async () => {
      await this.stopDepartureQueue.wait()
    })
    this.stopDepartureCache.debugStats()
    console.log(`Completed fetching schedules`)

    // FINAL STAGE: Apply filters and build final result
    this.callbacks.onComplete?.()
    this.updateProgress('complete', false)
    console.log(`🎉 Scenario complete: ${this.stopResults.length} stops, ${this.routeResults.length} routes`)
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions (): Promise<void> {
    const variables = { where: { bbox: convertBbox(this.config.bbox) } }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedData: FeedGql[] = response.data?.feeds || []
    this.feedVersions = feedData.map(feed => feed.feed_state.feed_version)
    // Send progress update with the new feed versions
    this.updateProgressWithNewData('feed-versions', true, { stops: [], routes: [], feedVersions: this.feedVersions })
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

    // Add to results
    this.stopResults.push(...stopData)
    console.log(`Fetched ${stopData.length} stops from ${task.feedOnestopId}:${task.feedVersionSha1}`)

    // Send progress update with only the NEW stops
    this.updateProgressWithNewData('stops', true, { stops: stopData, routes: [], feedVersions: [] })

    // Extract route IDs and fetch routes
    const routeIds: Set<number> = new Set()
    for (const stop of stopData) {
      for (const rs of stop.route_stops || []) {
        routeIds.add(rs.route?.id)
      }
    }

    // Enqueue route fetching
    if (routeIds.size > 0) {
      this.routeFetchQueue.enqueueOne({ feedOnestopId: task.feedOnestopId, feedVersionSha1: task.feedVersionSha1, ids: [...routeIds] })
    }

    // Enqueue stop departure fetching
    const stopIds = stopData.map(s => s.id)
    this.enqueueStopDepartureFetch(stopIds)

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
    // fetch dummy routes if empty to simplify control flow
    const currentRouteIds = new Set<number>(this.routeResults.map(r => r.id))
    const fetchRouteIds = task.ids.filter(id => !currentRouteIds.has(id))
    const response = await this.client.query<{ routes: RouteGql[] }>(routeQuery, { ids: fetchRouteIds.length > 0 ? fetchRouteIds : [0] })

    // Merge with existing routes
    const routeData: RouteGql[] = response.data?.routes || []
    const routeIdx = new Map<number, RouteGql>()
    for (const route of this.routeResults) {
      routeIdx.set(route.id, route)
    }
    for (const route of routeData) {
      routeIdx.set(route.id, route)
    }
    this.routeResults = [...routeIdx.values()]

    // Send progress update with only the NEW routes
    this.updateProgressWithNewData('routes', true, { stops: [], routes: routeData, feedVersions: [] })
  }

  // Fetch stop departures from GraphQL API
  private async fetchStopDepartures (task: StopDepartureQueryVars): Promise<void> {
    if (!this.config.scheduleEnabled || task.ids.length === 0) {
      return
    }

    const fetchDates = `sunday:${task.get('sunday')}, monday:${task.get('monday')}, tuesday:${task.get('tuesday')}, wednesday:${task.get('wednesday')}, thursday:${task.get('thursday')}, friday:${task.get('friday')}, saturday:${task.get('saturday')}`
    console.log(`Fetching stop departures for ${task.ids.length} stops on dates ${fetchDates}`)
    const response = await this.client.query<{ stops: StopDeparture[] }>(stopDepartureQuery, task)

    // Update cache
    const stopData: StopDeparture[] = response.data?.stops || []
    const dowDateStringLower = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    for (const dow of dowDateStringLower) {
      const dowDate = task.get(dow)
      if (!dowDate) {
        continue
      }
      for (const stop of stopData) {
        let r: StopTime[] = []
        if (dow === 'monday') { r = stop.monday || [] }
        if (dow === 'tuesday') { r = stop.tuesday || [] }
        if (dow === 'wednesday') { r = stop.wednesday || [] }
        if (dow === 'thursday') { r = stop.thursday || [] }
        if (dow === 'friday') { r = stop.friday || [] }
        if (dow === 'saturday') { r = stop.saturday || [] }
        if (dow === 'sunday') { r = stop.sunday || [] }
        this.stopDepartureCache.add(stop.id, dowDate, r)
      }
    }
  }

  // Enqueue stop departure fetching tasks
  private enqueueStopDepartureFetch (stopIds: number[]) {
    if (stopIds.length === 0) {
      return
    }

    const dates = getSelectedDateRange(this.config)
    const weekSize = 7
    const tasks: StopDepartureQueryVars[] = []

    // Build all tasks first
    for (let sid = 0; sid < stopIds.length; sid += this.stopTimeBatchSize) {
      for (let i = 0; i < dates.length; i += weekSize) {
        const w = new StopDepartureQueryVars()
        w.ids = stopIds.slice(sid, sid + this.stopTimeBatchSize)
        for (const d of dates.slice(i, i + weekSize)) {
          w.setDay(d)
        }
        tasks.push(w)
      }
    }

    // Enqueue all tasks
    this.stopDepartureQueue.enqueue(tasks)
  }

  private async wrapTimer (operation: string, stage: ScenarioProgress['currentStage'], fn: () => Promise<void>) {
    this.updateProgress(stage, true)
    const startTime = performance.now()
    console.log(`⏱️ Starting ${operation}...`)
    await fn()
    const duration = performance.now() - startTime
    console.log(`✅ Completed ${operation} in ${duration.toFixed(2)}ms`)
    this.updateProgress(stage, true)
  }

  private async updateProgress (stage: ScenarioProgress['currentStage'], loading: boolean) {
    this.callbacks.onProgress?.({
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage
    })
  }

  private async updateProgressWithNewData (stage: ScenarioProgress['currentStage'], loading: boolean, newData: { stops: StopGql[], routes: RouteGql[], feedVersions: FeedVersion[] }) {
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
  private fileStream: WriteStream | null = null

  constructor (callbacks: ScenarioCallbacks = {}) {
    this.callbacks = callbacks
    this.accumulatedData = {
      stops: [],
      routes: [],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: false
    }
  }

  saveStream (filename: string) {
    // Open a file stream for writing newline-delimited JSON
    this.fileStream = createWriteStream(filename, { encoding: 'utf8' })

    // Handle stream errors
    this.fileStream.on('error', (error) => {
      console.error('File stream error:', error)
      this.callbacks.onError?.(error)
    })
  }

  /**
   * Handle a progress event from ScenarioFetcher
   */
  onProgress (progress: ScenarioProgress): void {
    // If progress contains partial data, accumulate it
    if (progress.partialData) {
      // Append new stops
      if (progress.partialData.stops.length > 0) {
        this.accumulatedData.stops.push(...progress.partialData.stops)
      }

      // Append new routes
      if (progress.partialData.routes.length > 0) {
        this.accumulatedData.routes.push(...progress.partialData.routes)
      }

      // Append new feed versions
      if (progress.partialData.feedVersions.length > 0) {
        this.accumulatedData.feedVersions.push(...progress.partialData.feedVersions)
      }
    }

    // Write progress to file stream if streaming to file
    if (this.fileStream) {
      this.fileStream.write(JSON.stringify(progress) + '\n')
      // Immediately flush to ensure data is written
      this.fileStream.uncork()
    }

    // Forward progress to callback
    this.callbacks.onProgress?.(progress)
  }

  /**
   * Handle completion from ScenarioFetcher
   */
  onComplete (): void {
    // Mark data as complete
    this.accumulatedData.isComplete = true

    // Write completion to file stream if streaming to file
    if (this.fileStream) {
      const completionMessage: ScenarioProgress = { isLoading: false, currentStage: 'complete' }
      this.fileStream.write(JSON.stringify(completionMessage) + '\n', () => {
        // Close stream after write completes
        if (this.fileStream) {
          this.fileStream.end()
          this.fileStream = null
        }
      })
    }

    this.callbacks.onComplete?.()
  }

  /**
   * Handle error from ScenarioFetcher
   */
  onError (error: any): void {
    // Write error to file stream if streaming to file
    if (this.fileStream) {
      const errorMessage: ScenarioProgress = {
        isLoading: false,
        currentStage: 'complete',
        error: {
          message: error.message || error.toString(),
        }
      }
      this.fileStream.write(JSON.stringify(errorMessage) + '\n', () => {
        // Close stream after write completes
        if (this.fileStream) {
          this.fileStream.end()
          this.fileStream = null
        }
      })
    }

    this.callbacks.onError?.(error)
  }

  /**
   * Get the current accumulated data
   */
  getCurrentData (): ScenarioData {
    return { ...this.accumulatedData }
  }

  /**
   * Close the file stream if it's open
   */
  closeStream (): void {
    if (this.fileStream) {
      this.fileStream.end()
      this.fileStream = null
    }
  }
}

// ============================================================================
// STREAMING SERVER IMPLEMENTATION
// ============================================================================

/**
 * Server-side streaming sender
 * Converts ScenarioFetcher progress events to JSON messages over the wire
 */
export class ScenarioDataSender {
  private sendMessage: (message: ScenarioProgress) => void

  constructor (sendMessage: (message: ScenarioProgress) => void) {
    this.sendMessage = sendMessage
  }

  /**
   * Send scenario data using ScenarioFetcher with streaming callbacks
   */
  async sendScenario (config: ScenarioConfig): Promise<void> {
    try {
      // Create GraphQL client
      const client = new BasicGraphQLClient(
        process.env.TRANSITLAND_API_ENDPOINT || 'https://transit.land/api/v2/query',
        process.env.TRANSITLAND_API_KEY || 'test-key'
      )

      // Create ScenarioFetcher with streaming message sender
      const scenarioFetcher = new ScenarioFetcher(config, client, {
        onProgress: (progress) => {
          this.sendMessage(progress)
        },
        onComplete: () => {
          // onComplete is called but the result is returned from fetch()
          // We'll send the complete message after fetch() returns
        },
        onError: (error) => {
          console.error('ScenarioFetcher error:', error)
          this.sendMessage({
            isLoading: false,
            currentStage: 'complete',
            error: { message: error.message || 'Unknown error in ScenarioFetcher' }
          })
        }
      })

      // Start the scenario fetching process and get the final result
      await scenarioFetcher.fetch()

      // Send the complete message with the final result
      // this.sendMessage({ type: 'complete' })
    } catch (error) {
      console.error('Error in ScenarioDataSender:', error)
      this.sendMessage({
        isLoading: false,
        currentStage: 'complete',
        error: { message: error instanceof Error ? error.message : 'Unknown error in ScenarioDataSender' }
      })
      throw error
    }
  }
}

// ============================================================================
// STREAMING CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Streaming client receives messages from server and uses ScenarioDataReceiver
 */
export class ScenarioClient {
  /**
   * Fetch scenario data using streaming from server
   */
  async fetchScenario (
    config: ScenarioConfig,
    callbacks: ScenarioCallbacks = {}
  ): Promise<ScenarioData> {
    // Validate config
    if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      throw new Error('Either bbox or geographyIds must be provided')
    }

    // Create receiver to accumulate data from streaming messages
    const receiver = new ScenarioDataReceiver(callbacks)
    const response = await fetch('/api/scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue
        receiver.onProgress(JSON.parse(line) as ScenarioProgress)
      }
    }

    // Return current accumulated data if stream ended without completion
    return receiver.getCurrentData()
  }
}

/*****************
 * Apply filters to the scenario result data based on the provided configuration and filter criteria.
 */

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
    isComplete: true
  }
  return result
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

/**
 * Feed data from GraphQL
 */
export interface FeedVersion {
  id: string
  sha1: string
  feed: {
    id: number
    onestop_id: string
  }
}

export interface FeedGql {
  id: string
  onestop_id: string
  feed_state: {
    feed_version: FeedVersion
  }
}

export const feedVersionQuery = gql`
query ($where: FeedFilter) {
  feeds(where: $where) {
    id
    onestop_id
    feed_state {
      feed_version {
        id
        sha1
        feed {
          id
          onestop_id
        }
      }
    }
  }
}`
