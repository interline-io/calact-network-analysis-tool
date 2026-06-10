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
  logMemory,
  type CensusGeographyData,
  STOP_BUFFER_DEFAULT_LAYER,
} from '~~/src/core'
import type {
  FlexAreaFeature,
  FeedVersion,
  RouteGql,
  StopGql,
  BufferGeographyIntersection,
} from '~~/src/tl'
import { StopDepartureCache, FlexDepartureCache } from '~~/src/tl'
import { runBufferPasses, type BufferFetchConfig } from './buffer-passes'
import {
  runFeedVersionsPhase,
  runStopsPhase,
  runRoutesPhase,
  runDeparturesPhase,
  runFlexPhase,
  runCensusValuesPhase,
  StopDepartureTuple,
  FlexDepartureTuple,
  SCENARIO_PHASE_ORDER,
  type FeedVersionRef,
  type ResolvedGeographyContext,
  type ScenarioPhaseName,
} from './phases'

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
   * Whether to fetch stop departures (schedule data). Departures dominate
   * scenario loading time and size; disabling them allows quickly browsing
   * stops, routes, flex, and census data. Only meaningful when
   * includeFixedRoute is enabled. Defaults to true.
   */
  includeDepartures?: boolean
  /**
   * Whether to fetch flex service areas
   * Defaults to true
   */
  includeFlexAreas?: boolean
  /**
   * Whether to fetch census demographics: ACS values for the aggregation
   * layer (census-values stage) and the stop-buffer demographic passes.
   * Defaults to true.
   */
  includeCensus?: boolean
  // Picker overrides: onestop_id → fv_id. Record (not Map) for BFF JSON.
  feedVersionOverrides?: Record<string, number>
  // Picker-excluded onestop_ids. Dropped before any stop/route fetch.
  excludedFeeds?: string[]
  // 0 disables the per-entity buffer passes (#315 C/D/E/F).
  stopBufferRadius?: number
  // Aggregation-table rollup only fires when this is in `HIERARCHICAL_TIGER_LAYERS`.
  stopBufferLayer?: string
}

// Single source of truth for which phases a config enables. Drives both the
// emitted phase plan and fetchMain's execution gating, so the two cannot
// drift: a phase runs if and only if it is in the plan. Routes, departures,
// and buffers execute inside the stops block (they consume its ids), so
// their predicates must imply the stops predicate.
const PHASE_ENABLED: Record<ScenarioPhaseName, (config: ScenarioConfig) => boolean> = {
  'feed-versions': () => true,
  'stops': config => config.includeFixedRoute !== false,
  'routes': config => config.includeFixedRoute !== false,
  'departures': config => config.includeFixedRoute !== false
    && config.includeDepartures !== false,
  'buffers': config => config.includeFixedRoute !== false
    && config.includeCensus !== false
    && (config.stopBufferRadius ?? 0) > 0
    && !!config.tableDatasetName,
  'flex-areas': config => config.includeFlexAreas !== false,
  'census-values': config => config.includeCensus !== false
    && !!config.tableDatasetName
    && !!config.aggregateLayer,
}

// The enabled phases for a scenario config, in pipeline order.
export function scenarioPhasePlan (config: ScenarioConfig): ScenarioPhaseName[] {
  return SCENARIO_PHASE_ORDER.filter(phase => PHASE_ENABLED[phase](config))
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
  // Populated when `stopBufferRadius > 0`. Keyed by Stop.id.
  stopBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass D — server unions the buffer over the route's full stop set, not bbox-clipped.
  routeBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass E — same union semantics as routes, rolled up to the agency's full stop set.
  agencyBufferGeographies?: Map<number, BufferGeographyIntersection[]>
  // Pass F — union over every stop's buffer. Drives aggregation-table apportionment.
  aggregationBufferGeographies?: BufferGeographyIntersection[]
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
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'flex-areas' | 'census-values' | 'stop-buffer-geographies' | 'route-buffer-geographies' | 'agency-buffer-geographies' | 'aggregation-buffer-geographies' | 'complete' | 'ready' | 'extra'
  currentStageMessage?: string
  stopDepartureProgress?: { total: number, completed: number }
  feedVersionProgress?: { total: number, completed: number }
  error?: any
  // Non-fatal warnings the consumer should toast. Drained per delivery.
  warnings?: string[]
  // The enabled phases for this run, in pipeline order. Emitted once at the
  // start of a fetch; drives the weighted overall progress bar.
  phasePlan?: ScenarioPhaseName[]
  // The emitting phase's own task counters. Consumers keep the latest
  // fraction per phase and compute overall progress across the plan.
  phaseProgress?: { phase: ScenarioPhaseName, completed: number, total: number }
  // Each pass sets only the fields it produces.
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
    stopBufferGeographies?: [number, BufferGeographyIntersection[]][]
    routeBufferGeographies?: [number, BufferGeographyIntersection[]][]
    agencyBufferGeographies?: [number, BufferGeographyIntersection[]][]
    aggregationBufferGeographies?: BufferGeographyIntersection[]
  }
  extraData?: any
  config?: any
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

// Powers /api/buffer-geographies — the SPA's snappy radius/layer refetch path.
export async function streamBufferGeographies (
  controller: ReadableStreamDefaultController,
  config: BufferFetchConfig,
  client: GraphQLClient,
): Promise<void> {
  const stream = requestStream(controller)
  const writer = stream.getWriter()
  const sender = new ScenarioStreamSender(writer)

  sender.onProgress({
    isLoading: true,
    currentStage: 'ready',
    currentStageMessage: 'Starting buffer refetch',
  })

  try {
    await runBufferPasses(config, client, p => sender.onProgress(p))
  } catch (err) {
    sender.onError(err)
    writer.close()
    return
  }

  sender.onComplete()
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

// ============================================================================
// SCENARIO FETCHER - Composition of the pipeline phases
// ============================================================================

/**
 * Composes the scenario pipeline out of the standalone phases in ./phases:
 *
 *   feed-versions ─┬─ stops ─┬─ departures ──┐
 *                  │         └─ routes ──────┴─ buffer passes
 *                  ├─ flex
 *                  └─ census-values
 *
 * Each phase is also exposed as its own server endpoint (server/api/scenario/*)
 * so clients can run, skip, shard, or retry them independently.
 */
export class ScenarioFetcher {
  private config: ScenarioConfig
  private callbacks: ScenarioCallbacks
  private client: GraphQLClient

  // Latest per-phase queue counters, summed into the legacy progress fields
  // so every emitted event carries pipeline-wide numbers (the loading modal
  // computes its percentage from these).
  private stopsProgress = { total: 0, completed: 0 }
  private routesProgress = { total: 0, completed: 0 }
  private departuresProgress = { total: 0, completed: 0 }

  constructor (
    config: ScenarioConfig,
    client: GraphQLClient,
    callbacks: ScenarioCallbacks = {}
  ) {
    this.config = config
    this.callbacks = callbacks
    this.client = client
  }

  async fetch () {
    try {
      await this.fetchMain()
    } catch (error) {
      this.callbacks.onError?.(error)
      throw error
    }
  }

  // Phase emissions carry only their own queue counters; route them into the
  // right slot and re-emit with the summed pipeline totals attached.
  private emitProgress (progress: ScenarioProgress): void {
    if (progress.feedVersionProgress) {
      if (progress.currentStage === 'stops') {
        this.stopsProgress = progress.feedVersionProgress
      } else if (progress.currentStage === 'routes') {
        this.routesProgress = progress.feedVersionProgress
      }
    }
    if (progress.stopDepartureProgress) {
      this.departuresProgress = progress.stopDepartureProgress
    }
    this.callbacks.onProgress?.({
      ...progress,
      feedVersionProgress: {
        total: this.stopsProgress.total + this.routesProgress.total,
        completed: this.stopsProgress.completed + this.routesProgress.completed,
      },
      stopDepartureProgress: { ...this.departuresProgress },
    })
  }

  // Start the scenario fetching process
  private async fetchMain () {
    logMemory('fetchMain-start')
    const emit = (progress: ScenarioProgress) => this.emitProgress(progress)
    const onError = (error: any) => this.callbacks.onError?.(error)

    // Announce the plan before any work so the progress bar can apportion
    // its slices across exactly the phases this run will execute. The same
    // plan gates execution below.
    const plan = scenarioPhasePlan(this.config)
    const enabled = new Set(plan)
    console.log(`[Scenario] phase plan: ${plan.join(', ')}`)
    this.emitProgress({
      isLoading: true,
      currentStage: 'ready',
      currentStageMessage: 'Planning scenario phases',
      phasePlan: plan,
    })

    // FIRST STAGE: resolve the geography and active feed versions in the area
    const { feedVersions, resolved } = await runFeedVersionsPhase({
      bbox: this.config.bbox,
      geographyIds: this.config.geographyIds,
      geoDatasetName: this.config.geoDatasetName,
      feedVersionOverrides: this.config.feedVersionOverrides,
      excludedFeeds: this.config.excludedFeeds,
    }, this.client, emit)
    logMemory('after-feed-versions')
    const fvRefs: FeedVersionRef[] = feedVersions.map(fv => ({
      feedOnestopId: fv.feed.onestop_id,
      feedVersionSha1: fv.sha1,
    }))

    if (enabled.has('stops')) {
      const { stopIds, routeIds } = await runStopsPhase({
        feedVersions: fvRefs,
        bbox: this.config.bbox,
        geographyIds: this.config.geographyIds,
        geoDatasetName: this.config.geoDatasetName,
        stopLimit: this.config.stopLimit,
      }, this.client, emit, { onError })
      logMemory('after-stops')

      // Departures fan out concurrently with routes, recovering the queue
      // overlap the pre-phase pipeline had.
      const departuresPromise = enabled.has('departures')
        ? runDeparturesPhase({
            stopIds,
            startDate: this.config.startDate,
            endDate: this.config.endDate,
            departureMode: this.config.departureMode,
          }, this.client, emit, { onError })
        : Promise.resolve()
      const { agencyIds } = enabled.has('routes')
        ? await runRoutesPhase({ routeIds }, this.client, emit, { onError })
        : { agencyIds: [] }
      logMemory('after-routes')
      await departuresPromise
      logMemory('after-departures')

      // Serial batched (no measured need for concurrency at current entity counts).
      if (enabled.has('buffers')) {
        await this.fetchBufferData(stopIds, routeIds, agencyIds)
      }
      logMemory('after-buffer-passes')
    }

    // Flex areas and census values both only depend on feed versions / the
    // resolved bbox (set during feed-versions) so they can run concurrently.
    await Promise.all([
      enabled.has('flex-areas')
        ? runFlexPhase({
            feedVersions: fvRefs,
            startDate: this.config.startDate,
            endDate: this.config.endDate,
          }, this.client, emit, { onError })
        : Promise.resolve(),
      enabled.has('census-values') ? this.fetchCensusValues(resolved) : Promise.resolve(),
    ])
    logMemory('after-flex-and-census')

    // Done - send completion progress event (client will handle onComplete)
    this.emitProgress({ isLoading: false, currentStage: 'complete' })
    logMemory('fetchMain-complete')
    console.log(`🎉 Scenario complete`)
  }

  // Config projection around the census-values phase; the inline path passes
  // the already-resolved geography so the phase doesn't re-query. Gating is
  // the plan's job (PHASE_ENABLED) — this guard exists for type narrowing
  // and would only fire on a plan/config inconsistency bug.
  private async fetchCensusValues (resolved: ResolvedGeographyContext): Promise<void> {
    const { tableDatasetName, aggregateLayer, geoDatasetName } = this.config
    if (!tableDatasetName || !aggregateLayer) {
      console.warn('[CensusValues] Planned but tableDatasetName/aggregateLayer missing — skipping')
      return
    }
    await runCensusValuesPhase({
      bbox: resolved.bbox,
      within: resolved.within,
      geoDatasetName,
      tableDatasetName,
      aggregateLayer,
      stopBufferRadius: this.config.stopBufferRadius,
    }, this.client, p => this.emitProgress(p))
  }

  // Delegates to `runBufferPasses` so the same logic runs standalone via
  // /api/buffer-geographies on radius/layer changes. Gating is the plan's
  // job (PHASE_ENABLED) — this guard exists for type narrowing and would
  // only fire on a plan/config inconsistency bug.
  private async fetchBufferData (stopIds: number[], routeIds: number[], agencyIds: number[]): Promise<void> {
    const { tableDatasetName, geoDatasetName } = this.config
    const radius = this.config.stopBufferRadius ?? 0
    if (radius <= 0 || !tableDatasetName) {
      console.warn('[BufferData] Planned but stopBufferRadius/tableDatasetName missing — skipping')
      return
    }
    await runBufferPasses(
      {
        radius,
        layer: this.config.stopBufferLayer || STOP_BUFFER_DEFAULT_LAYER,
        geoDatasetName,
        tableDatasetName,
        stopIds,
        routeIds,
        agencyIds,
      },
      this.client,
      progress => this.emitProgress(progress),
    )
  }
}

function mergeIntoMap<K, V> (
  partial: [K, V][] | undefined,
  accumulator: Map<K, V> | undefined,
): void {
  if (!partial || !accumulator) {
    return
  }
  for (const [k, v] of partial) {
    accumulator.set(k, v)
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
      stopBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      routeBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      agencyBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      aggregationBufferGeographies: [],
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
      mergeIntoMap(p.tripIdStrings, this.accumulatedData.tripIdStrings)
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
      mergeIntoMap(p.censusGeographies, this.accumulatedData.censusGeographies)
      mergeIntoMap(p.stopBufferGeographies, this.accumulatedData.stopBufferGeographies)
      mergeIntoMap(p.routeBufferGeographies, this.accumulatedData.routeBufferGeographies)
      mergeIntoMap(p.agencyBufferGeographies, this.accumulatedData.agencyBufferGeographies)
      if (p.aggregationBufferGeographies && this.accumulatedData.aggregationBufferGeographies) {
        this.accumulatedData.aggregationBufferGeographies.push(...p.aggregationBufferGeographies)
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

  // Reset before a radius/layer refetch so stale ids don't linger in the maps.
  clearBufferGeographies (): void {
    this.accumulatedData.stopBufferGeographies?.clear()
    this.accumulatedData.routeBufferGeographies?.clear()
    this.accumulatedData.agencyBufferGeographies?.clear()
    if (this.accumulatedData.aggregationBufferGeographies) {
      this.accumulatedData.aggregationBufferGeographies.length = 0
    }
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
