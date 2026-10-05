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
  StopCensusGeography,
  BufferGeographyIntersection,
} from '~~/src/tl'
import { StopDepartureCache, FlexDepartureCache } from '~~/src/tl'
import { runProgressStream, type ProgressEmit } from './progress-stream'
import { phaseDone, type PhaseOpts } from './phases/common'
import {
  runFeedVersionsPhase,
  runBufferPasses,
  runStopClustersPhase,
  type StopCluster,
  runStopsPhase,
  runStopCensusPhase,
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
  // Whether to fetch fixed-route data (stops, routes, departures). Default true.
  includeFixedRoute?: boolean
  // Whether to fetch flex service areas. Default true.
  includeFlexAreas?: boolean
  // Whether to fetch route shapes (default true; the map needs them). Geometry
  // is 98% of the routes payload, so route-classifying consumers turn it off.
  includeRouteGeometry?: boolean
  // Explicit calendar dates (`yyyy-MM-dd`) to fetch departures for, instead
  // of the whole startDate..endDate range. Must include the day before each
  // date read: a departure stated past 24:00:00 falls on the next day.
  departureDates?: string[]
  // Whether to fetch census demographics (aggregation-layer ACS values and
  // the stop-buffer passes). Default true.
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

// Which phases a browse config enables — the derived plan for runs that don't
// declare one. Report phases join a run only through a declared plan.
//
// Routes, departures, and buffers execute inside the stops block (they
// consume its ids), so their predicates must imply the stops predicate.
const PHASE_ENABLED: Record<ScenarioPhaseName, (config: ScenarioConfig) => boolean> = {
  'feed-versions': () => true,
  'stops': config => config.includeFixedRoute !== false,
  // Executes inside the stops block, so the predicate implies stops. Not
  // gated on includeCensus: the aggregation table has always worked without
  // it, back when these geographies rode on the stop query.
  'stop-census': config => config.includeFixedRoute !== false && !!config.aggregateLayer,
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

// The per-phase predicate behind scenarioPhasePlan, shared with the client
// refetch gates so they cannot drift from the plan derivation.
export function phaseEnabled (phase: ScenarioPhaseName, config: ScenarioConfig): boolean {
  return PHASE_ENABLED[phase](config)
}

// Whether a config carries a search area: a bbox or at least one geography
// id. The one validation every run entry point shares, client and server.
export function hasSearchArea (config: Pick<ScenarioConfig, 'bbox' | 'geographyIds'>): boolean {
  return !!config.bbox || (config.geographyIds?.length ?? 0) > 0
}

// The enabled phases for a browse config, in pipeline order. Runs with a
// fixed phase set declare a plan instead (ScenarioFetcher's `plan`).
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
  // Stop-level thresholds on total visits during the filtered period (the
  // Stops report's "Total Visits During Time Period", issue #243).
  stopVisitsUnder?: number
  stopVisitsOver?: number
  // max transfer time (minutes) for the client-side temporal cluster
  // prune. 0/undefined leaves the proximity clusters unfiltered.
  clusterMaxTransferMinutes?: number
}

// Accumulated scenario results.
export interface ScenarioData {
  routes: RouteGql[]
  stops: StopGql[]
  feedVersions: FeedVersion[]
  stopDepartureCache: StopDepartureCache
  flexDepartureCache: FlexDepartureCache
  // Flex service areas (GTFS-Flex / DRT).
  flexAreas: FlexAreaFeature[]
  // Sidecar map of numeric trip.id → GTFS trip_id string, kept one entry per
  // unique trip for debug UIs; the departure cache drops the string for
  // memory efficiency.
  tripIdStrings?: Map<number, string>
  // Aggregation-layer geographies per stop, joined onto each Stop by the
  // result filter. Populated when `aggregateLayer` is set.
  stopCensusGeographies?: Map<number, StopCensusGeography[]>
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

// Callback interface for scenario stream receivers.
export interface ScenarioCallbacks {
  // Awaitable so a streaming consumer can apply backpressure; see PhaseEmit.
  onProgress?: (progress: ScenarioProgress) => void | Promise<void>
  onComplete?: () => void
  onError?: (error: any) => void
}

// One NDJSON event on a scenario stream.
export interface ScenarioProgress {
  // A phase name, or one of the envelope's frames ('ready' opens the run,
  // 'complete'/'error' end it). Sub-steps within a phase distinguish
  // themselves through currentStageMessage.
  currentStage: ScenarioPhaseName | 'ready' | 'complete' | 'error'
  currentStageMessage?: string
  error?: any
  // Non-fatal warnings the consumer should toast.
  warnings?: string[]
  // Requests that failed after exhausting their retries; the run continues,
  // so the consumer must show these — the results are incomplete.
  requestErrors?: RequestFailure[]
  // The run's phases in pipeline order, announced on the 'ready' event.
  phasePlan?: ScenarioPhaseName[]
  // The emitting phase's own task counters; consumers keep the latest
  // fraction per phase and compute overall progress across the plan.
  phaseProgress?: { phase: ScenarioPhaseName, completed: number, total: number }
  // Each pass sets only the fields it produces.
  partialData?: {
    stops?: StopGql[]
    // Stop id -> its geographies at the aggregation layer.
    stopCensusGeographies?: [number, StopCensusGeography[]][]
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

// Stream scenario NDJSON to a controller without accumulating — the
// memory-constrained server/BFF path.
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

// Run the scenario fetcher, both streaming to the controller and returning
// the accumulated data — the CLI path.
export async function runScenarioFetcher (controller: ReadableStreamDefaultController, config: ScenarioConfig, client: GraphQLClient): Promise<ScenarioData> {
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

// Options for a fetcher run beyond the phase contract's emit.
export interface ScenarioFetcherOpts extends PhaseOpts {
  // Phases to execute, in pipeline order. Defaults to the browse-derived
  // plan for the config; a report run declares its own.
  plan?: ScenarioPhaseName[]
}

// Composes the scenario pipeline out of the standalone phases in ./phases:
//
//   feed-versions ─┬─ stops ─┬─ departures ───┐
//                  │         ├─ stop-census ──┤
//                  │         └─ routes ───────┴─ buffer passes
//                  ├─ flex
//                  └─ census-values
//
// Follows the same contract as a phase — emit plus non-fatal onError — and
// runs inside a stream envelope that owns the run's framing.
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
    this.onError = opts.onError ?? (() => {})
    this.plan = opts.plan ?? scenarioPhasePlan(config)
  }

  async fetch () {
    logMemory('fetchMain-start')
    const emit = this.emit
    const onError = this.onError

    // The plan gates execution here; announcing it is the envelope's job.
    // Phases in the plan this fetcher doesn't implement (the report phases)
    // are run afterwards by whoever composed it.
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
        stopLimit: this.config.stopLimit,
      }, this.client, emit, { onError })
      scenarioStopIds = stopIds
      logMemory('after-stops')

      // Departures, the per-stop census, and routes all consume only the stop
      // ids, so all three run together. Awaited as one group rather than in
      // sequence: an `await` between them strands whichever is still running
      // when an earlier one rejects, and its rejection surfaces later with no
      // handler attached.
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
      const stopCensusPromise = enabled.has('stop-census')
        ? this.fetchStopCensus(stopIds, onError)
        : Promise.resolve()
      const routesPromise = enabled.has('routes')
        ? runRoutesPhase({
            routeIds,
            includeGeometry: this.config.includeRouteGeometry,
          }, this.client, emit, { onError })
        : Promise.resolve({ agencyIds: [] as number[] })
      const [, , { agencyIds }] = await Promise.all([departuresPromise, stopCensusPromise, routesPromise])
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

    // No completion event here: 'complete' is the envelope's, emitted once
    // the whole run — including any report phases after this — has finished.
    logMemory('fetchMain-complete')
    console.log(`🎉 Scenario fetch complete`)

    // Returned so report stages don't re-resolve the geography context.
    return { resolvedGeography: resolved }
  }

  // Config projection around the stop-census phase. Unlike its siblings the
  // guard is reachable: WSDOT_PHASE_PLAN declares this phase unconditionally,
  // so a report config without an aggregation layer lands here — and has to
  // close the slice it was planned for, or the progress bar never fills.
  private async fetchStopCensus (stopIds: number[], onError: (error: any) => void): Promise<void> {
    const { aggregateLayer, geoDatasetName } = this.config
    if (!aggregateLayer) {
      console.warn('[StopCensus] Planned but aggregateLayer missing — skipping')
      await this.emit({ currentStage: 'stop-census', phaseProgress: phaseDone('stop-census') })
      return
    }
    await runStopCensusPhase({
      stopIds,
      geoDatasetName,
      censusLayer: aggregateLayer,
    }, this.client, this.emit, { onError })
  }

  // Config projection around the census-values phase. Gating is the plan's
  // job; the guard is type narrowing that only fires on a plan/config bug.
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

  // Config projection around the buffer passes. Gating is the plan's job;
  // the guard is type narrowing that only fires on a plan/config bug.
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

  // Config projection around the stop-clusters phase. Gating is the plan's
  // job; the guard is type narrowing that only fires on a plan/config bug.
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

// Retention controls for a receiver. All three affect only this receiver's
// copy — the streamed events pass through untouched, so a downstream consumer
// still gets everything.
export interface ScenarioReceiverOptions {
  // Fold departures instead of accumulating them; `stopDepartureCache` stays
  // empty. A retained departure costs ~80 bytes, so a statewide scenario's
  // millions of them do not fit in a Cloudflare Worker.
  onStopDepartures?: (departures: readonly StopDepartureTuple[]) => void
  // Do not accumulate stops; `stops` stays empty. A StopGql costs ~970 bytes
  // of nested heap objects; consumers that read a few values per stop fold
  // them into flat records of their own instead.
  dropStops?: boolean
  // Accumulate routes without their geometry (~49 KB per route), for a server
  // that relays routes but never draws them.
  dropRouteGeometry?: boolean
}

// Receives progress events and accumulates ScenarioData, for in-process and
// streaming consumers alike.
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
      stopCensusGeographies: new Map<number, StopCensusGeography[]>(),
      censusGeographies: new Map<string, CensusGeographyData>(),
      stopBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      routeBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      agencyBufferGeographies: new Map<number, BufferGeographyIntersection[]>(),
      aggregationBufferGeographies: [],
      stopClusters: [],
    }
  }

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
      // Skipped alongside the stops themselves: the WSDOT path folds these off
      // the event into its own records and has no stops to join them to.
      if (!this.options.dropStops) {
        mergeIntoMap(p.stopCensusGeographies, this.accumulatedData.stopCensusGeographies)
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

  onComplete (): void {
    this.callbacks.onComplete?.()
  }

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

  // Reset before an aggregate-layer refetch: these are single-layer, so the
  // previous layer's entries are wrong rather than merely stale.
  clearStopCensusGeographies (): void {
    this.accumulatedData.stopCensusGeographies?.clear()
  }

  // A shallow copy of the accumulated data so far.
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

// NDJSON stream reader for scenario progress events.
export class ScenarioStreamReceiver extends GenericStreamReceiver<ScenarioProgress, ScenarioData> {}
