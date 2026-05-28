import { format } from 'date-fns'
import bbox from '@turf/bbox'
import area from '@turf/area'
import {
  type WeekdayMode,
  type RouteType,
  type Weekday,
  type Bbox,
  type GraphQLClient,
  GenericStreamReceiver,
  GenericStreamSender,
  multiplexStream,
  requestStream,
  TaskQueue,
  convertBbox,
  chunkArray,
  logMemory,
  parseHMS,
  fetchCensusIntersection,
  REQUIRED_ACS_TABLES,
  type CensusGeographyData,
  padBboxMeters,
} from '~~/src/core'
import type { FlexAreaFeature,
  FeedGql,
  FeedVersion,
  RouteGql,
  StopDeparture,
  StopGql,
  StopTime,
  FlexLocationQueryResponse,
  FlexStopTimesQueryResponse,
  TractIntersection,
} from '~~/src/tl'
import {
  StopDepartureCache,
  FlexDepartureCache,
  feedVersionQuery,
  feedVersionsByIdsQuery,
  HIDDEN_FEED_ONESTOP_IDS,
  applyFeedVersionOverrides,
  routeQuery,
  stopDepartureQuery,
  stopTimeQuery,
  stopQuery,
  flexLocationQuery,
  flexStopTimesQuery,
  transformLocationsToFlexAreas,
  fetchEntityBufferTracts,
} from '~~/src/tl'
import { STOP_BUFFER_TRACT_LAYER } from '~~/src/core'
import { geographyLayerQuery } from '~~/src/tl/census'

// Constants for progress updates
const PROGRESS_LIMIT_STOPS = 1000
const PROGRESS_LIMIT_ROUTES = 10
const PROGRESS_LIMIT_STOP_DEPARTURES = 100_000_000

// Per-request batch sizes for the route / agency buffer passes (#315 D, E).
// Smaller than the stop batch because each entity expands to its full stop
// set server-side, multiplying the cost of a single request.
const BUFFER_ENTITY_BATCH_SIZE = 50

/**
 * Maximum number of flex locations to fetch per feed version.
 * This limit is enforced server-side by transitland-server.
 * If a feed version has more locations than this, some will be silently skipped.
 */
const MAX_FLEX_LOCATIONS_PER_FEED_VERSION = 100_000

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
  // ACS dataset (e.g. `acsdt5y2021`). When set with `aggregateLayer`, the
  // pipeline fetches census values for those geographies.
  tableDatasetName?: string
  /**
   * Whether to fetch fixed-route transit data (stops, routes, departures)
   * Defaults to true
   */
  includeFixedRoute?: boolean
  /**
   * Whether to fetch flex service areas
   * Defaults to true
   */
  includeFlexAreas?: boolean
  // Picker overrides: onestop_id → fv_id. Record (not Map) for BFF JSON.
  feedVersionOverrides?: Record<string, number>
  // Picker-excluded onestop_ids. Dropped before any stop/route fetch.
  excludedFeeds?: string[]
  /**
   * Stop statistical radius in meters (issue #315). When > 0, the pipeline
   * fetches per-stop / per-route / per-agency / aggregation-union census
   * intersections at the tract layer in addition to the bbox-clipped Pass A,
   * powering apportioned demographic columns in the report tables. 0
   * disables — Pass A retains today's bbox-only semantics.
   */
  stopBufferRadius?: number
}

export interface ScenarioFilter {
  startTime?: Date
  endTime?: Date
  selectedRouteTypes?: RouteType[]
  selectedWeekdays?: Weekday[]
  selectedWeekdayMode?: WeekdayMode
  selectedAgencies?: string[]
  frequencyUnder?: number
  frequencyOver?: number
}

// =============================================================================
// Flex service (GTFS-Flex / DRT) GraphQL integration
// See: https://github.com/interline-io/transitland-lib/pull/527
// =============================================================================
//
// Flex areas are fetched via GraphQL in fetchFlexAreas():
// - Queries Location type for each feed version
// - Filters by date via StopTimeFilter.date on Location.stop_times
// - Transforms Location -> FlexAreaFeature in BFF before streaming
// - Frontend applies user filters (advance notice, area type, color mode)
//
// GraphQL types used:
// - Location: flex service areas (polygons from locations.geojson)
// - FlexStopTime: stop times with pickup/dropoff types and booking rules
// - BookingRule: booking_type (0=real-time, 1=same-day, 2=prior-day)
//

/**
 * Scenario results
 */
export interface ScenarioData {
  routes: RouteGql[]
  stops: StopGql[]
  feedVersions: FeedVersion[]
  stopDepartureCache: StopDepartureCache
  flexDepartureCache: FlexDepartureCache
  /**
   * Flex service areas (GTFS-Flex / DRT)
   * Currently loaded from static GeoJSON, will come from GraphQL API later
   */
  flexAreas: FlexAreaFeature[]
  /**
   * Sidecar map of numeric trip.id → GTFS trip_id string. The main
   * StopDepartureCache drops the string for memory efficiency; this map keeps
   * one entry per unique trip for debug UIs (Route Timetable modal). Optional
   * so existing non-streaming constructions of ScenarioData keep compiling.
   */
  tripIdStrings?: Map<number, string>
  // Populated when `tableDatasetName` + `aggregateLayer` are both set.
  censusGeographies?: Map<string, CensusGeographyData>
  /**
   * Per-stop tract intersections + ACS values for the stop statistical
   * radius buffer (#315). Populated when `stopBufferRadius > 0`. Keyed by
   * Stop.id (numeric, internal). Each entry's TractIntersection[] is the
   * union of tracts the stop's buffer touches; consumers apportion via
   * `apportionBuffer()` from `src/core/census-buffer.ts`.
   */
  stopBufferTracts?: Map<number, TractIntersection[]>
  /**
   * Per-route buffer tract intersections (Pass D). Server unions the buffer
   * over every stop the route touches (full stop set, not bbox-clipped).
   */
  routeBufferTracts?: Map<number, TractIntersection[]>
  /**
   * Per-agency buffer tract intersections (Pass E). Same union semantics
   * as routes, but rolled up to the agency's full stop set.
   */
  agencyBufferTracts?: Map<number, TractIntersection[]>
  /**
   * Single-payload aggregation buffer (Pass F): the union of every stop's
   * buffer in the scenario, intersected with tracts. Drives the
   * aggregation-table apportioned values + the `pct_buffer_coverage` column.
   */
  aggregationBufferTracts?: TractIntersection[]
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
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'flex-areas' | 'census-values' | 'stop-buffer-tracts' | 'route-buffer-tracts' | 'agency-buffer-tracts' | 'aggregation-buffer-tracts' | 'complete' | 'ready' | 'extra'
  currentStageMessage?: string
  stopDepartureProgress?: { total: number, completed: number }
  feedVersionProgress?: { total: number, completed: number }
  error?: any
  // Non-fatal warnings the consumer should toast. Drained per delivery.
  warnings?: string[]
  // Partial data available during progress. All fields optional — only the
  // pass that fired the event sets the relevant ones.
  partialData?: {
    stops?: StopGql[]
    routes?: RouteGql[]
    feedVersions?: FeedVersion[]
    flexAreas?: FlexAreaFeature[]
    stopDepartures?: StopDepartureTuple[]
    flexDepartures?: FlexDepartureTuple[]
    // Per-batch slice of new numeric-tripId → GTFS-trip_id pairs. Only the
    // newly-seen pairs are shipped per batch; the receiver merges into a
    // single accumulated map.
    tripIdStrings?: [number, string][]
    censusGeographies?: [string, CensusGeographyData][]
    stopBufferTracts?: [number, TractIntersection[]][]
    routeBufferTracts?: [number, TractIntersection[]][]
    agencyBufferTracts?: [number, TractIntersection[]][]
    aggregationBufferTracts?: TractIntersection[]
  }
  extraData?: any
  config?: any
}

// Define the tuple type with named fields
// Optimized wire format: departure_time as seconds, no string trip_id
export type StopDepartureTuple = readonly [
  stop_id: number,
  departure_date: string,
  departure_time: number, // seconds since midnight
  trip_id: number,
  trip_direction_id: number,
  trip_route_id: number
]

// Helper functions for working with the tuple
export const StopDepartureTuple = {
  create: (
    stop_id: number,
    departure_date: string,
    departure_time: number,
    trip_id: number,
    trip_direction_id: number,
    trip_route_id: number,
  ): StopDepartureTuple => [stop_id, departure_date, departure_time, trip_id, trip_direction_id, trip_route_id],
  fromStopTime: (stopId: number, departureDate: string, stopDeparture: StopTime) => StopDepartureTuple.create(
    stopId,
    departureDate,
    parseHMS(stopDeparture.departure_time),
    stopDeparture.trip.id,
    stopDeparture.trip.direction_id,
    stopDeparture.trip.route.id,
  ),
  stopId: (tuple: StopDepartureTuple) => tuple[0],
  departureDate: (tuple: StopDepartureTuple) => tuple[1],
  departureTime: (tuple: StopDepartureTuple) => tuple[2],
  tripId: (tuple: StopDepartureTuple) => tuple[3],
  tripDirectionId: (tuple: StopDepartureTuple) => tuple[4],
  tripRouteId: (tuple: StopDepartureTuple) => tuple[5],
}

// Wire format for flex departure cache: [locationId, date]
export type FlexDepartureTuple = readonly [
  location_id: number,
  departure_date: string,
]

export const FlexDepartureTuple = {
  create: (location_id: number, departure_date: string): FlexDepartureTuple => [location_id, departure_date],
  locationId: (tuple: FlexDepartureTuple) => tuple[0],
  departureDate: (tuple: FlexDepartureTuple) => tuple[1],
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

/**
 * Variables for the slim multi-date flex stop_times query.
 * Mirrors StopDepartureQueryVars but uses fvSha1/limit instead of stop ids.
 */
export class FlexStopTimesQueryVars {
  fvSha1: string = ''
  limit: number = 0
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
      case 'monday': return this.monday
      case 'tuesday': return this.tuesday
      case 'wednesday': return this.wednesday
      case 'thursday': return this.thursday
      case 'friday': return this.friday
      case 'saturday': return this.saturday
      case 'sunday': return this.sunday
    }
    return ''
  }

  setDay (d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0: this.sunday = format(d, dateFmt); this.include_sunday = true; break
      case 1: this.monday = format(d, dateFmt); this.include_monday = true; break
      case 2: this.tuesday = format(d, dateFmt); this.include_tuesday = true; break
      case 3: this.wednesday = format(d, dateFmt); this.include_wednesday = true; break
      case 4: this.thursday = format(d, dateFmt); this.include_thursday = true; break
      case 5: this.friday = format(d, dateFmt); this.include_friday = true; break
      case 6: this.saturday = format(d, dateFmt); this.include_saturday = true; break
    }
  }

  hasAnyDay (): boolean {
    return this.include_monday || this.include_tuesday || this.include_wednesday
      || this.include_thursday || this.include_friday || this.include_saturday
      || this.include_sunday
  }
}

/**
 * Stream scenario data to a controller. This is the core streaming primitive.
 * Does not accumulate data - just streams NDJSON to the controller.
 *
 * Use this directly for server/BFF endpoints where memory is constrained.
 * For cases that need accumulated data, compose with multiplexStream + ScenarioStreamReceiver.
 */
export async function streamScenario (controller: ReadableStreamDefaultController, config: ScenarioConfig, client: GraphQLClient): Promise<void> {
  const stream = requestStream(controller)
  const writer = stream.getWriter()

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

  // Start the fetch process
  await fetcher.fetch()

  // Final complete
  scenarioDataSender.onComplete()
  writer.close()
}

/**
 * Run the scenario fetcher, streaming results and accumulating data.
 * This is a convenience wrapper that composes streamScenario with accumulation.
 *
 * For server/BFF use where memory is constrained, use streamScenario directly.
 */
export async function runScenarioFetcher (controller: ReadableStreamDefaultController, config: ScenarioConfig, client: GraphQLClient): Promise<ScenarioData> {
  // Multiplex stream: one copy streams to controller, one copy accumulates
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

  // Configure receiver for accumulation
  const receiver = new ScenarioDataReceiver({})
  const scenarioDataClient = new ScenarioStreamReceiver()
  const scenarioClientProgress = scenarioDataClient.processStream(outputStream, receiver)

  // Start the fetch process
  await fetcher.fetch()

  // Final complete - close the multiplexed stream
  scenarioDataSender.onComplete()
  writer.close()

  // Ensure all scenario client progress has been processed
  const { data } = await scenarioClientProgress

  // Return the accumulated data
  return data
}

export class ScenarioFetcher {
  private config: ScenarioConfig
  private callbacks: ScenarioCallbacks
  private client: GraphQLClient

  // Internal state
  private stopLimit = 1000
  private stopTimeBatchSize = 100
  private maxConcurrentRequests = 8
  private feedVersionPageSize = 100

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
  private flexFetchQueue: TaskQueue<FeedVersion>

  // Internal result bookkeeping
  private fetchedRouteIds: Set<number> = new Set()
  // IDs accumulated during stops/routes fetch for the #315 buffer passes.
  // Agencies are discovered inside route data, not fetched explicitly.
  private bufferStopIds: Set<number> = new Set()
  private bufferAgencyIds: Set<number> = new Set()
  private feedVersions: FeedVersion[] = []
  // Drained on the next updateProgress() so non-fatal stage warnings ride the
  // existing progress channel without a new transport.
  private pendingWarnings: string[] = []
  // Set by fetchFeedVersions(), read by fetchCensusValues().
  private resolvedBbox?: Bbox
  // First admin polygon, used as `within` for census intersection so the
  // server clips against the real polygon. Multi-boundary support is #347.
  private resolvedWithin?: GeoJSON.Polygon

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

    this.flexFetchQueue = new TaskQueue<FeedVersion>(
      this.maxConcurrentRequests,
      task => this.fetchFlexArea(task), {
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
    logMemory('fetchMain-start')

    // FIRST STAGE: Fetch active feed versions in the area
    this.feedVersions = await this.fetchFeedVersions()
    console.log(`Found ${this.feedVersions.length} feed versions`)
    for (const fv of this.feedVersions) {
      console.log(`    ${fv.feed?.onestop_id} ${fv.sha1}`)
    }
    logMemory('after-feed-versions')

    // Fetch fixed-route transit data if enabled (default: true)
    const includeFixedRoute = this.config.includeFixedRoute !== false
    console.log(`[Scenario] includeFixedRoute = ${includeFixedRoute}`)
    if (includeFixedRoute) {
      for (const fv of this.feedVersions) {
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
      logMemory('after-stops')
      await this.routeFetchQueue.wait()
      logMemory('after-routes')
      await this.stopDepartureQueue.wait()
      logMemory('after-departures')
      // Buffer passes (#315) run after stops + routes are known. Serial,
      // batched — concurrency adds complexity for marginal speedup at the
      // entity counts we see; revisit if a scenario ever feels slow here.
      await this.fetchBufferData()
      logMemory('after-buffer-passes')
    } else {
      console.log('[Scenario] Skipping fixed-route data (not enabled)')
    }

    // Flex areas and census values both only depend on the resolved bbox
    // (set during feed-versions) so they can run concurrently.
    const includeFlexAreas = this.config.includeFlexAreas !== false
    console.log(`[Scenario] includeFlexAreas = ${includeFlexAreas}`)
    if (!includeFlexAreas) {
      console.log('[Scenario] Skipping flex areas (not enabled)')
    }
    await Promise.all([
      includeFlexAreas ? this.fetchFlexAreas() : Promise.resolve(),
      this.fetchCensusValues(),
    ])
    logMemory('after-flex-and-census')

    // Done - send completion progress event (client will handle onComplete)
    this.updateProgress('complete', false)
    logMemory('fetchMain-complete')
    console.log(`🎉 Scenario complete`)
  }

  /**
   * Fetch flex service areas (GTFS-Flex / DRT) via GraphQL
   *
   * Queries locations for each feed version, filters out those without
   * active service on the selected date, and transforms to FlexAreaFeature format.
   */
  private async fetchFlexAreas (): Promise<void> {
    if (this.feedVersions.length === 0) {
      console.log('[FlexAreas] No feed versions available, skipping flex area fetch')
      return
    }

    this.updateProgress('flex-areas', true)
    console.log(`[FlexAreas] Fetching flex areas from ${this.feedVersions.length} feed versions`)

    for (const fv of this.feedVersions) {
      this.flexFetchQueue.enqueueOne(fv)
    }
    await this.flexFetchQueue.run()

    console.log(`[FlexAreas] Complete`)
  }

  // Fetch flex areas for a single feed version
  private async fetchFlexArea (fv: FeedVersion): Promise<void> {
    const queryDate = this.config.startDate
      ? format(this.config.startDate, 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd')

    const variables = {
      fvSha1: fv.sha1,
      limit: MAX_FLEX_LOCATIONS_PER_FEED_VERSION,
      serviceDate: queryDate,
    }

    const response = await this.client.query<FlexLocationQueryResponse>(flexLocationQuery, variables)

    const feedVersionData = response.data?.feed_versions?.[0]
    if (!feedVersionData) {
      return
    }

    const locations = feedVersionData.locations || []
    const flexAreas = transformLocationsToFlexAreas(locations)

    if (flexAreas.length > 0) {
      console.log(`[FlexAreas] Found ${flexAreas.length} flex areas in ${fv.feed.onestop_id}`)
      this.updateProgress('flex-areas', true, { flexAreas })
    }

    // Fetch slim multi-date stop_times to populate the flex departure cache.
    // Chunk the date range into 7-day windows (one query per week) so every
    // date in a multi-week scenario is covered — mirrors the stop-departure pattern.
    if (flexAreas.length > 0) {
      const dowNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
      const dates = getSelectedDateRange(this.config)
      const weekSize = 7
      const flexDepartures: FlexDepartureTuple[] = []
      for (let i = 0; i < dates.length; i += weekSize) {
        const w = new FlexStopTimesQueryVars()
        w.fvSha1 = fv.sha1
        w.limit = MAX_FLEX_LOCATIONS_PER_FEED_VERSION
        for (const d of dates.slice(i, i + weekSize)) {
          w.setDay(d)
        }
        if (!w.hasAnyDay()) { continue }
        const stopTimesResponse = await this.client.query<FlexStopTimesQueryResponse>(flexStopTimesQuery, w)
        for (const location of stopTimesResponse?.data?.feed_versions?.[0]?.locations || []) {
          for (const dowName of dowNames) {
            const date = w.get(dowName)
            if (!date) { continue }
            if ((location[dowName]?.length ?? 0) > 0) {
              flexDepartures.push(FlexDepartureTuple.create(location.id, date))
            }
          }
        }
      }
      if (flexDepartures.length > 0) {
        this.updateProgress('flex-areas', true, { flexDepartures })
      }
    }
  }

  // Skipped when the caller didn't set an ACS dataset or aggregation layer.
  // Single-layer fetch (the active `aggregateLayer`). When
  // `stopBufferRadius > 0`, the bbox is padded by the radius so that buffers
  // crossing the edge still see the tracts they overlap. Buffer-specific
  // tract values (#315) come from the per-entity Passes C / D / E / F, which
  // request `values` inline via the stop_buffer resolver, so this pass is
  // intentionally kept narrow.
  private async fetchCensusValues (): Promise<void> {
    const { tableDatasetName, aggregateLayer, geoDatasetName } = this.config
    if (!tableDatasetName || !aggregateLayer) {
      console.log('[CensusValues] Skipping (tableDatasetName or aggregateLayer not set)')
      return
    }
    if (!this.resolvedBbox) {
      console.warn('[CensusValues] No resolved bbox — skipping')
      return
    }
    this.updateProgress('census-values', true)
    const radius = this.config.stopBufferRadius && this.config.stopBufferRadius > 0
      ? this.config.stopBufferRadius
      : 0
    const fetchBbox = radius > 0 ? padBboxMeters(this.resolvedBbox, radius) : this.resolvedBbox
    console.log(`[CensusValues] Fetching ${REQUIRED_ACS_TABLES.length} ACS tables for layer=${aggregateLayer} (radius padding=${radius}m)`)
    const features = await fetchCensusIntersection({
      client: this.client,
      geoDatasetName,
      geoDatasetLayer: aggregateLayer,
      tableDatasetName,
      tableNames: REQUIRED_ACS_TABLES,
      bbox: fetchBbox,
      within: this.resolvedWithin,
    })
    const entries: [string, CensusGeographyData][] = features.map(f => [
      f.properties.geoid,
      {
        id: f.properties.geography_id,
        name: f.properties.name,
        values: f.properties.values,
        intersectionRatio: f.properties.intersection_ratio,
        geometryArea: f.properties.geometry_area,
        intersectionArea: f.properties.intersection_area,
        layer: aggregateLayer,
      },
    ])
    console.log(`[CensusValues] Fetched values for ${entries.length} geographies`)
    this.updateProgress('census-values', true, { censusGeographies: entries })
  }

  // Passes C / D / E / F (#315). Serial; each chunk streams partial progress.
  private async fetchBufferData (): Promise<void> {
    const { tableDatasetName, geoDatasetName } = this.config
    const radius = this.config.stopBufferRadius ?? 0
    if (radius <= 0 || !tableDatasetName) {
      return
    }
    const baseConfig = {
      client: this.client,
      geoDataset: geoDatasetName,
      tableDataset: tableDatasetName,
      tableNames: REQUIRED_ACS_TABLES,
      layer: STOP_BUFFER_TRACT_LAYER,
      radius,
    }
    const stopIds = [...this.bufferStopIds]
    for (const chunk of chunkArray(stopIds, this.stopTimeBatchSize)) {
      const results = await fetchEntityBufferTracts('stops', { ...baseConfig, ids: chunk })
      this.updateProgress('stop-buffer-tracts', true, { stopBufferTracts: results })
    }
    for (const chunk of chunkArray([...this.fetchedRouteIds], BUFFER_ENTITY_BATCH_SIZE)) {
      const results = await fetchEntityBufferTracts('routes', { ...baseConfig, ids: chunk })
      this.updateProgress('route-buffer-tracts', true, { routeBufferTracts: results })
    }
    for (const chunk of chunkArray([...this.bufferAgencyIds], BUFFER_ENTITY_BATCH_SIZE)) {
      const results = await fetchEntityBufferTracts('agencies', { ...baseConfig, ids: chunk })
      this.updateProgress('agency-buffer-tracts', true, { agencyBufferTracts: results })
    }

    // Pass F — single top-level union over every stop's buffer.
    if (stopIds.length > 0) {
      const features = await fetchCensusIntersection({
        client: this.client,
        geoDatasetName,
        geoDatasetLayer: STOP_BUFFER_TRACT_LAYER,
        tableDatasetName,
        tableNames: REQUIRED_ACS_TABLES,
        stopIds,
        stopBufferRadius: radius,
      })
      const tracts: TractIntersection[] = features
        .filter(f => (f.properties.geometry_area ?? 0) > 0)
        .map(f => ({
          geoid: f.properties.geoid,
          layer: f.properties.layer_name || STOP_BUFFER_TRACT_LAYER,
          geometryArea: f.properties.geometry_area,
          intersectionArea: f.properties.intersection_area,
          values: f.properties.values,
        }))
      console.log(`[AggregationBuffer] union over ${stopIds.length} stops → ${tracts.length} tracts`)
      this.updateProgress('aggregation-buffer-tracts', true, { aggregationBufferTracts: tracts })
    }
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions (): Promise<FeedVersion[]> {
    let searchBbox = this.config.bbox
    // If using one or more administrative boundaries, compute a bbox around them
    if (this.config.geographyIds && this.config.geographyIds.length > 0) {
      // First get the geometry for the administrative boundaries
      const geogResponse = await this.client.query<{ census_datasets: { geographies: { geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] }[] }>(
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

        // Backend `within` is typed as Polygon, so for a MultiPolygon pick
        // the largest part as a stand-in until #347 lands.
        const firstGeom: GeoJSON.Geometry = features[0]!.geometry
        if (firstGeom.type === 'MultiPolygon' && firstGeom.coordinates.length > 0) {
          let bestCoords = firstGeom.coordinates[0]!
          let bestArea = area({ type: 'Polygon', coordinates: bestCoords })
          for (let i = 1; i < firstGeom.coordinates.length; i++) {
            const coords = firstGeom.coordinates[i]!
            const a = area({ type: 'Polygon', coordinates: coords })
            if (a > bestArea) {
              bestCoords = coords
              bestArea = a
            }
          }
          this.resolvedWithin = { type: 'Polygon', coordinates: bestCoords }
          if (firstGeom.coordinates.length > 1) {
            console.warn(`[Scenario] Admin boundary is a MultiPolygon with ${firstGeom.coordinates.length} parts; using the largest part for census intersection (#347).`)
          }
        } else if (firstGeom.type === 'Polygon') {
          this.resolvedWithin = firstGeom
        }
      } else {
        console.warn('No features found in census datasets response')
      }
    }

    this.resolvedBbox = searchBbox

    // Use the bbox (either user-specified or computed around admin boundaries) to query feed versions
    // Paginate to ensure we get all feeds (API default limit is 100)
    const bboxForQuery = convertBbox(searchBbox)
    const allFeeds: FeedGql[] = []
    let after = 0
    while (true) {
      const variables = { where: { bbox: bboxForQuery }, limit: this.feedVersionPageSize, after }
      const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
      const page = response.data?.feeds || []
      // Drop feeds with known-broken bbox metadata so they don't poison
      // every other bbox query with their over-broad coverage claim.
      for (const f of page) {
        if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
        allFeeds.push(f)
      }
      if (page.length < this.feedVersionPageSize) {
        break
      }
      const nextAfter = parseInt(page[page.length - 1]!.id, 10)
      if (!Number.isInteger(nextAfter)) {
        throw new Error(`[FeedVersions] Invalid pagination cursor: id="${page[page.length - 1]!.id}" did not parse as an integer`)
      }
      after = nextAfter
    }
    const feedVersions = await this.resolveFeedVersionsForScenario(allFeeds)

    this.updateProgress('feed-versions', true, { feedVersions })

    return feedVersions
  }

  // GraphQL lookup + warning surfacing wrapped around applyFeedVersionOverrides
  // (pure projection, tested separately).
  private async resolveFeedVersionsForScenario (allFeeds: FeedGql[]): Promise<FeedVersion[]> {
    const overrides = new Map<string, number>(
      this.config.feedVersionOverrides ? Object.entries(this.config.feedVersionOverrides) : []
    )
    const excluded = new Set<string>(this.config.excludedFeeds || [])

    const overrideById = new Map<number, FeedVersion>()
    if (overrides.size > 0) {
      const needed: number[] = []
      for (const f of allFeeds) {
        if (excluded.has(f.onestop_id)) { continue }
        const id = overrides.get(f.onestop_id)
        if (id != null) { needed.push(id) }
      }
      if (needed.length > 0) {
        const resp = await this.client.query<{ feed_versions: FeedVersion[] }>(
          feedVersionsByIdsQuery,
          { ids: needed }
        )
        for (const fv of resp.data?.feed_versions || []) {
          // fv.id arrives as a string from GraphQL — coerce for Map key parity.
          const idNum = typeof fv.id === 'string' ? parseInt(fv.id, 10) : fv.id
          if (Number.isFinite(idNum)) { overrideById.set(idNum, fv) }
        }
      }
    }

    const { feedVersions, missing } = applyFeedVersionOverrides(allFeeds, overrides, excluded, overrideById)
    if (missing.length > 0) {
      const msg = `Could not resolve ${missing.length} pinned feed version(s): ${missing.map(m => `${m.onestop_id}:${m.fv_id}`).join(', ')}`
      console.warn(`[Scenario] ${msg}`)
      this.pendingWarnings.push(msg)
    }
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
      this.updateProgress('stops', true, { stops: stopBatch })
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

    // Accumulate stop IDs for #315 buffer passes (run later in fetchBufferData).
    if ((this.config.stopBufferRadius ?? 0) > 0) {
      for (const id of stopIds) {
        this.bufferStopIds.add(id)
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
      this.updateProgress('routes', true, { routes: routeBatch })
    }

    // Accumulate agency IDs for the #315 buffer passes; routes are already
    // collected via `fetchedRouteIds`.
    if ((this.config.stopBufferRadius ?? 0) > 0) {
      for (const r of routeData) {
        const aid = r.agency?.id
        if (aid != null) {
          this.bufferAgencyIds.add(aid)
        }
      }
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
    const tripIdStrings = new Map<number, string>()
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
        for (const st of stopTimes) {
          stopDepartures.push(StopDepartureTuple.fromStopTime(stop.id, dowDate, st))
          if (st.trip.trip_id && !tripIdStrings.has(st.trip.id)) {
            tripIdStrings.set(st.trip.id, st.trip.trip_id)
          }
        }
      }
    }

    // Send progress updates in batches using the generic helper function.
    // The tripIdStrings sidecar rides on the first batch; subsequent batches
    // in the same fetch would only duplicate the same entries, so we clear it.
    const tripIdStringPairs: [number, string][] = [...tripIdStrings.entries()]
    let sentTripIdStrings = false
    for (const stopDepartureBatch of chunkArray(stopDepartures, PROGRESS_LIMIT_STOP_DEPARTURES)) {
      this.updateProgress('schedules', true, {
        stopDepartures: stopDepartureBatch,
        tripIdStrings: sentTripIdStrings ? undefined : tripIdStringPairs,
      })
      sentTripIdStrings = true
    }
  }

  private async updateProgress (stage: ScenarioProgress['currentStage'], loading: boolean, newData?: ScenarioProgress['partialData']) {
    const warnings = this.pendingWarnings.length > 0 ? this.pendingWarnings : undefined
    if (warnings) { this.pendingWarnings = [] }
    this.callbacks.onProgress?.({
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage,
      partialData: newData,
      warnings,
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
      flexDepartureCache: new FlexDepartureCache(),
      flexAreas: [],
      tripIdStrings: new Map<number, string>(),
      censusGeographies: new Map<string, CensusGeographyData>(),
      stopBufferTracts: new Map<number, TractIntersection[]>(),
      routeBufferTracts: new Map<number, TractIntersection[]>(),
      agencyBufferTracts: new Map<number, TractIntersection[]>(),
      aggregationBufferTracts: [],
    }
  }

  /**
   * Handle a progress event from ScenarioFetcher
   */
  onProgress (progress: ScenarioProgress): void {
    const p = progress.partialData
    if (p) {
      if (p.stops) {
        this.accumulatedData.stops.push(...p.stops)
      }
      if (p.routes) {
        this.accumulatedData.routes.push(...p.routes)
      }
      if (p.feedVersions) {
        this.accumulatedData.feedVersions.push(...p.feedVersions)
      }
      if (p.stopDepartures) {
        for (const event of p.stopDepartures) {
          this.accumulatedData.stopDepartureCache.addFromWire(
            StopDepartureTuple.stopId(event),
            StopDepartureTuple.departureDate(event),
            StopDepartureTuple.departureTime(event),
            StopDepartureTuple.tripId(event),
            StopDepartureTuple.tripDirectionId(event),
            StopDepartureTuple.tripRouteId(event),
          )
        }
      }
      if (p.tripIdStrings && this.accumulatedData.tripIdStrings) {
        for (const [numericId, stringId] of p.tripIdStrings) {
          this.accumulatedData.tripIdStrings.set(numericId, stringId)
        }
      }
      if (p.flexAreas) {
        this.accumulatedData.flexAreas.push(...p.flexAreas)
      }
      if (p.flexDepartures) {
        for (const tuple of p.flexDepartures) {
          this.accumulatedData.flexDepartureCache.add(
            FlexDepartureTuple.locationId(tuple),
            FlexDepartureTuple.departureDate(tuple),
          )
        }
      }
      if (p.censusGeographies && this.accumulatedData.censusGeographies) {
        for (const [geoid, data] of p.censusGeographies) {
          this.accumulatedData.censusGeographies.set(geoid, data)
        }
      }
      if (p.stopBufferTracts && this.accumulatedData.stopBufferTracts) {
        for (const [stopId, tracts] of p.stopBufferTracts) {
          this.accumulatedData.stopBufferTracts.set(stopId, tracts)
        }
      }
      if (p.routeBufferTracts && this.accumulatedData.routeBufferTracts) {
        for (const [routeId, tracts] of p.routeBufferTracts) {
          this.accumulatedData.routeBufferTracts.set(routeId, tracts)
        }
      }
      if (p.agencyBufferTracts && this.accumulatedData.agencyBufferTracts) {
        for (const [agencyId, tracts] of p.agencyBufferTracts) {
          this.accumulatedData.agencyBufferTracts.set(agencyId, tracts)
        }
      }
      if (p.aggregationBufferTracts && this.accumulatedData.aggregationBufferTracts) {
        this.accumulatedData.aggregationBufferTracts.push(...p.aggregationBufferTracts)
      }
    }

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
    if (process.env.DEBUG_MEMORY) {
      const stats = {
        stops: this.accumulatedData.stops.length,
        routes: this.accumulatedData.routes.length,
        feedVersions: this.accumulatedData.feedVersions.length,
        flexAreas: this.accumulatedData.flexAreas.length,
        departureCacheStops: this.accumulatedData.stopDepartureCache.cache.size,
      }
      console.log('[ScenarioDataReceiver] accumulated data stats:', stats)
      logMemory('getCurrentData')
    }
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
