import {
  type WeekdayMode,
  type RouteType,
  type Weekday,
  type Bbox,
  type GraphQLClient,
  type RequestFailure,
  GenericStreamReceiver,
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
import { runProgressStream, type ProgressEmit } from './progress-stream'
import type { PhaseOpts } from './phases/common'
import {
  runFeedVersionsPhase,
  runBufferPasses,
  runStopClustersPhase,
  type StopCluster,
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

// Configuration for scenario fetching
export interface ScenarioConfig {
  reportName: string
  bbox?: Bbox
  startDate?: Date
  endDate?: Date
  geographyIds?: number[]
  stopLimit?: number
  aggregateLayer?: string
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
  /**
   * Whether to fetch each route's shape. Defaults to true, which the map
   * needs. Route geometry is 98% of the routes query's bytes and costs
   * several times that again as parsed coordinate arrays, so consumers that
   * only classify routes should turn it off.
   */
  includeRouteGeometry?: boolean
  /**
   * Whether to fetch every census layer on each stop. Defaults to true, which
   * is what lets the aggregation layer change without refetching the whole
   * scenario. All seven layers are 41% of the stops payload, so a report that
   * fixes one layer should turn this off; `aggregateLayer` is then the only
   * layer fetched.
   */
  includeAllCensusLayers?: boolean
  /**
   * Explicit calendar dates (`yyyy-MM-dd`) to fetch departures for, instead of
   * every day from startDate to endDate. A report that reads a few days out of
   * a wide scenario range sets this so its departure cost follows the days it
   * reads rather than the range the user picked. Must include the day before
   * each date read: a departure stated past 24:00:00 falls on the next day.
   */
  departureDates?: string[]
  /**
   * Whether to fetch census demographics: ACS values for the aggregation
   * layer (census-values stage) and the stop-buffer demographic passes.
   * Defaults to true.
   */
  includeCensus?: boolean
  // Also fetch the clipped outlines of each census geography. Set from the
  // display so a run started in a clipped mode arrives ready to draw, rather
  // than needing a follow-up recompute.
  includeIntersectionGeometry?: boolean
  // Picker overrides: onestop_id → fv_id. Record (not Map) for BFF JSON.
  feedVersionOverrides?: Record<string, number>
  // Picker-excluded onestop_ids. Dropped before any stop/route fetch.
  excludedFeeds?: string[]
  // 0 disables the per-entity buffer passes (C/D/E/F).
  stopBufferRadius?: number
  // Aggregation-table rollup only fires when this is in `HIERARCHICAL_TIGER_LAYERS`.
  stopBufferLayer?: string
  // Stop clustering. > 0 (meters) enables the stop-clusters phase; 0/unset disables.
  // The max-transfer-time filter is client-side, so it's not part of the fetch config.
  stopClusterDistance?: number
}

// Single source of truth for which phases a *browse* config enables: the
// derived plan for runs that don't declare one. Routes, departures, and
// buffers execute inside the stops block (they consume its ids), so their
// predicates must imply the stops predicate. Report phases are never part of
// a derived plan — they join a run only through an explicitly declared plan
// (e.g. WSDOT_PHASE_PLAN).
const PHASE_ENABLED: Record<ScenarioPhaseName, (config: ScenarioConfig) => boolean> = {
  'feed-versions': () => true,
  'stops': config => config.includeFixedRoute !== false,
  'routes': config => config.includeFixedRoute !== false,
  'departures': config => config.includeFixedRoute !== false,
  'buffers': config => config.includeFixedRoute !== false
    && config.includeCensus !== false
    && (config.stopBufferRadius ?? 0) > 0
    && !!config.tableDatasetName,
  'stop-clusters': config => config.includeFixedRoute !== false
    && (config.stopClusterDistance ?? 0) > 0,
  'flex-areas': config => config.includeFlexAreas !== false,
  'census-values': config => config.includeCensus !== false
    && !!config.tableDatasetName
    && !!config.aggregateLayer,
  'wsdot-levels': () => false,
  'wsdot-geographies': () => false,
}

// Whether a browse config enables a phase — the per-phase predicate behind
// scenarioPhasePlan, shared with the client refetch gates so they cannot
// drift from the plan derivation.
export function phaseEnabled (phase: ScenarioPhaseName, config: ScenarioConfig): boolean {
  return PHASE_ENABLED[phase](config)
}

// Whether a config carries a search area: a bbox or at least one geography id.
// The one validation every run entry point shares, client and server.
export function hasSearchArea (config: Pick<ScenarioConfig, 'bbox' | 'geographyIds'>): boolean {
  return !!config.bbox || (config.geographyIds?.length ?? 0) > 0
}

// The enabled phases for a browse config, in pipeline order. Runs with their
// own fixed phase set declare a plan instead (ScenarioFetcher's `plan`).
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
  // max transfer time (minutes) for the client-side temporal cluster
  // prune. 0/undefined leaves the proximity clusters unfiltered.
  clusterMaxTransferMinutes?: number
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
  // cross-agency transfer-hub clusters (proximity + assignment). The
  // max-transfer-time filter is applied later, client-side, in scenario-filter.
  stopClusters?: StopCluster[]
}

/**
 * Callback interface for scenario stream receivers
 */
export interface ScenarioCallbacks {
  // Awaitable so a streaming consumer can apply backpressure; see PhaseEmit.
  onProgress?: (progress: ScenarioProgress) => void | Promise<void>
  onComplete?: () => void
  onError?: (error: any) => void
}

/**
 * Progress information for scenario fetching
 */
export interface ScenarioProgress {
  // A phase name, or one of the envelope's frames ('ready' opens the run,
  // 'complete'/'error' end it). Sub-steps within a phase (the buffer passes)
  // distinguish themselves through currentStageMessage.
  currentStage: ScenarioPhaseName | 'ready' | 'complete' | 'error'
  currentStageMessage?: string
  error?: any
  // Non-fatal warnings the consumer should toast. Drained per delivery.
  warnings?: string[]
  // Requests that failed after exhausting their retries. The run continues, so
  // the consumer must show these — the results are incomplete without them.
  requestErrors?: RequestFailure[]
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
    // the full set of derived clusters (recomputed each time, not merged).
    stopClusters?: StopCluster[]
  }
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
  // One derived plan flows to both the announcement and the fetcher's
  // execution gate, so the two cannot drift.
  const plan = scenarioPhasePlan(config)
  await runProgressStream(requestStream(controller), client, {
    startMessage: 'Starting scenario fetcher',
    config,
    phasePlan: plan,
  }, async (emit, onError) => {
    const fetcher = new ScenarioFetcher(config, client, emit, { onError, plan })
    await fetcher.fetch()
  })
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
  const receiver = new ScenarioDataReceiver({})
  const scenarioClientProgress = new ScenarioStreamReceiver().processStream(outputStream, receiver)

  const plan = scenarioPhasePlan(config)
  await runProgressStream(inputStream, client, {
    startMessage: 'Starting scenario fetcher',
    config,
    phasePlan: plan,
  }, async (emit, onError) => {
    const fetcher = new ScenarioFetcher(config, client, emit, { onError, plan })
    await fetcher.fetch()
  })

  // Ensure all scenario client progress has been processed
  const { data } = await scenarioClientProgress
  return data
}

// ============================================================================
// SCENARIO FETCHER - Composition of the pipeline phases
// ============================================================================

// Options for a fetcher run, beyond the phase contract's emit. onError is the
// per-task (non-fatal) failure hook, normally the envelope's failure reporter;
// fatal errors throw out of fetch() and are the envelope's to report.
export interface ScenarioFetcherOpts extends PhaseOpts {
  // The phases to execute, in pipeline order. Defaults to the browse-derived
  // plan for the config; a report run declares its own.
  plan?: ScenarioPhaseName[]
}

/**
 * Composes the scenario pipeline out of the standalone phases in ./phases:
 *
 *   feed-versions ─┬─ stops ─┬─ departures ──┐
 *                  │         └─ routes ──────┴─ buffer passes
 *                  ├─ flex
 *                  └─ census-values
 *
 * Each phase is also exposed as its own server endpoint (server/api/scenario/*)
 * so clients can run, skip, shard, or retry them independently. The fetcher
 * itself follows the same contract as a phase — emit plus a non-fatal onError
 * — and runs inside a stream envelope that owns the run's framing.
 */
export class ScenarioFetcher {
  private config: ScenarioConfig
  private client: GraphQLClient
  private emit: ProgressEmit
  private onError: (error: any) => void

  // The phases this run executes, in pipeline order.
  private plan: ScenarioPhaseName[]

  constructor (
    config: ScenarioConfig,
    client: GraphQLClient,
    emit: ProgressEmit = () => {},
    opts: ScenarioFetcherOpts = {},
  ) {
    this.config = config
    this.client = client
    this.emit = emit
    // A failed task doesn't abort its phase — it reports and the rest continue.
    this.onError = opts.onError ?? (() => {})
    this.plan = opts.plan ?? scenarioPhasePlan(config)
  }

  async fetch () {
    logMemory('fetchMain-start')
    const emit = this.emit
    const onError = this.onError

    // The plan gates execution here; announcing it to the stream is the
    // envelope's job (the 'ready' event), since a run may include report
    // phases executed after this fetcher by whoever composed it. Phases in
    // the plan this fetcher doesn't implement are simply not its to run.
    const enabled = new Set(this.plan)
    console.log(`[Scenario] phase plan: ${this.plan.join(', ')}`)

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

    // Hoisted out of the stops block: the census-values phase clips against
    // these when a stop buffer radius is set.
    let scenarioStopIds: number[] = []

    if (enabled.has('stops')) {
      const { stopIds, routeIds, routeStopIds } = await runStopsPhase({
        feedVersions: fvRefs,
        bbox: this.config.bbox,
        geographyIds: this.config.geographyIds,
        geoDatasetName: this.config.geoDatasetName,
        stopLimit: this.config.stopLimit,
        censusLayer: this.config.includeAllCensusLayers === false ? this.config.aggregateLayer : undefined,
      }, this.client, emit, { onError })
      scenarioStopIds = stopIds
      logMemory('after-stops')

      // Departures fan out concurrently with routes, recovering the queue
      // overlap the pre-phase pipeline had.
      const departuresPromise = enabled.has('departures')
        ? runDeparturesPhase({
            stopIds,
            startDate: this.config.startDate,
            endDate: this.config.endDate,
            dates: this.config.departureDates,
            routeIds,
            routeStopIds,
          }, this.client, emit, { onError })
        : Promise.resolve()
      const { agencyIds } = enabled.has('routes')
        ? await runRoutesPhase({
            routeIds,
            includeGeometry: this.config.includeRouteGeometry,
          }, this.client, emit, { onError })
        : { agencyIds: [] }
      logMemory('after-routes')
      await departuresPromise
      logMemory('after-departures')

      if (enabled.has('buffers')) {
        await this.fetchBufferData(stopIds, routeIds, agencyIds, onError)
      }
      logMemory('after-buffer-passes')

      // Clusters re-query the same stop set (with nearby_stops neighbors) rather
      // than reusing stopIds, so they only need the feed-version refs + bbox.
      if (enabled.has('stop-clusters')) {
        await this.fetchStopClusters(fvRefs)
      }
      logMemory('after-stop-clusters')
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
      enabled.has('census-values') ? this.fetchCensusValues(resolved, scenarioStopIds) : Promise.resolve(),
    ])
    logMemory('after-flex-and-census')

    // No completion event here: 'complete' belongs to the stream envelope
    // (runProgressStream), which emits it once the whole run — including any
    // analysis stage layered after these phases — has finished.
    logMemory('fetchMain-complete')
    console.log(`🎉 Scenario fetch complete`)

    // The geography context the feed-versions phase resolved, for callers
    // that run report stages after the fetch (so they don't re-resolve).
    return { resolvedGeography: resolved }
  }

  // Config projection around the census-values phase; the inline path passes
  // the already-resolved geography so the phase doesn't re-query. Gating is
  // the plan's job (PHASE_ENABLED) — this guard exists for type narrowing
  // and would only fire on a plan/config inconsistency bug.
  private async fetchCensusValues (resolved: ResolvedGeographyContext, stopIds: number[]): Promise<void> {
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
      stopIds,
      includeIntersectionGeometry: this.config.includeIntersectionGeometry,
    }, this.client, this.emit)
  }

  // Delegates to `runBufferPasses` so the same logic runs standalone via
  // /api/buffer-geographies on radius/layer changes. Gating is the plan's
  // job (PHASE_ENABLED) — this guard exists for type narrowing and would
  // only fire on a plan/config inconsistency bug.
  private async fetchBufferData (stopIds: number[], routeIds: number[], agencyIds: number[], onError: (error: any) => void): Promise<void> {
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
      this.emit,
      { onError },
    )
  }

  // Delegates to `runStopClustersPhase` so the same logic runs standalone via
  // /api/stop-clusters on distance changes. Gating is the plan's job
  // (PHASE_ENABLED) — this guard only fires on a plan/config inconsistency bug.
  private async fetchStopClusters (fvRefs: FeedVersionRef[]): Promise<void> {
    const distance = this.config.stopClusterDistance ?? 0
    if (distance <= 0) {
      console.warn('[StopClusters] Planned but stopClusterDistance missing — skipping')
      return
    }
    await runStopClustersPhase(
      {
        feedVersions: fvRefs,
        bbox: this.config.bbox,
        geographyIds: this.config.geographyIds,
        geoDatasetName: this.config.geoDatasetName,
        maxDistanceMeters: distance,
        stopLimit: this.config.stopLimit,
      },
      this.client,
      this.emit,
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

export interface ScenarioReceiverOptions {
  /**
   * Fold departures instead of accumulating them. When set, each streamed
   * batch is handed to this callback and `stopDepartureCache` is left empty.
   *
   * A retained departure costs ~80 bytes, so a statewide scenario's several
   * million of them do not fit alongside everything else in a Cloudflare
   * Worker. Consumers that only need a derived summary (the WSDOT report reads
   * per-hour counts and nothing else) fold here and hold constant memory.
   */
  onStopDepartures?: (departures: readonly StopDepartureTuple[]) => void
  /**
   * Do not accumulate stops; `stops` is left empty.
   *
   * A StopGql costs ~970 bytes, most of it in the separate heap objects behind
   * `geometry`, `feed_version`, `census_geographies` and `route_stops` rather
   * than in the fields themselves. A consumer that reads a handful of values
   * per stop folds them into a flat record of its own, which measures ~300,
   * and sets this so the whole ones are not held alongside.
   *
   * Retention only. A consumer folding stops reads them from the progress
   * events it is already receiving, so that its fold does not silently stop
   * happening when someone asks for the whole ones to be kept as well.
   */
  dropStops?: boolean
  /**
   * Accumulate routes without their geometry. The streamed events are left
   * untouched, so a browser downstream still receives the shapes; only this
   * receiver's copy is slimmed. For a server that streams routes on to a
   * client but never draws them itself, holding a second copy of 49 KB per
   * route is what the memory limit is spent on.
   */
  dropRouteGeometry?: boolean
}

/**
 * Receives progress events and accumulates ScenarioData
 * This is the core logic used by both in-process and streaming scenarios
 */
export class ScenarioDataReceiver {
  private accumulatedData: ScenarioData
  private callbacks: ScenarioCallbacks
  private options: ScenarioReceiverOptions

  constructor (callbacks: ScenarioCallbacks = {}, options: ScenarioReceiverOptions = {}) {
    this.callbacks = callbacks
    this.options = options
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
      stopClusters: [],
    }
  }

  /**
   * Handle a progress event from ScenarioFetcher
   */
  onProgress (progress: ScenarioProgress): void | Promise<void> {
    const p = progress.partialData
    if (p) {
      if (p.stops && !this.options.dropStops) {
        this.accumulatedData.stops.push(...p.stops)
      }
      if (p.routes && this.options.dropRouteGeometry) {
        for (const route of p.routes) {
          const { geometry: _geometry, ...rest } = route
          this.accumulatedData.routes.push(rest)
        }
      } else if (p.routes) {
        this.accumulatedData.routes.push(...p.routes)
      }
      if (p.feedVersions) {
        this.accumulatedData.feedVersions.push(...p.feedVersions)
      }
      if (p.stopDepartures && this.options.onStopDepartures) {
        this.options.onStopDepartures(p.stopDepartures)
      } else if (p.stopDepartures) {
        for (const event of p.stopDepartures) {
          this.accumulatedData.stopDepartureCache.addFromWire(
            StopDepartureTuple.stopId(event),
            StopDepartureTuple.departureDate(event),
            StopDepartureTuple.departureTime(event),
            StopDepartureTuple.tripId(event),
            StopDepartureTuple.tripDirectionId(event),
            StopDepartureTuple.tripRouteId(event),
            StopDepartureTuple.pickupType(event),
          )
        }
      }
      // The sidecar only exists to name the departures the cache holds, so a
      // receiver that folds them has nothing to pair it with. One entry per
      // trip is not free at statewide scale.
      if (!this.options.onStopDepartures) {
        mergeIntoMap(p.tripIdStrings, this.accumulatedData.tripIdStrings)
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
      mergeIntoMap(p.censusGeographies, this.accumulatedData.censusGeographies)
      mergeIntoMap(p.stopBufferGeographies, this.accumulatedData.stopBufferGeographies)
      mergeIntoMap(p.routeBufferGeographies, this.accumulatedData.routeBufferGeographies)
      mergeIntoMap(p.agencyBufferGeographies, this.accumulatedData.agencyBufferGeographies)
      if (p.aggregationBufferGeographies && this.accumulatedData.aggregationBufferGeographies) {
        this.accumulatedData.aggregationBufferGeographies.push(...p.aggregationBufferGeographies)
      }
      // Clusters are emitted as one complete set per run, so replace rather
      // than append — a distance refetch supersedes the previous clusters.
      if (p.stopClusters) {
        this.accumulatedData.stopClusters = p.stopClusters
      }
    }

    return this.callbacks.onProgress?.(progress)
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

  // Reset before a cluster-distance refetch so stale clusters don't linger if
  // the new run errors before emitting.
  clearStopClusters (): void {
    this.accumulatedData.stopClusters = []
  }

  // Reset before an aggregate-layer refetch so the previous layer's geographies
  // don't linger in the map (choropleth ids are read from this map).
  clearCensusGeographies (): void {
    this.accumulatedData.censusGeographies?.clear()
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

/**
 * Streaming client processes readable streams and uses ScenarioDataReceiver
 */
export class ScenarioStreamReceiver extends GenericStreamReceiver<ScenarioProgress, ScenarioData> {}
