import { type Bbox } from './geom'
import { type dow, routeTypes } from './constants'
import { format } from 'date-fns'
import { gql } from 'graphql-tag'
import {
  type StopDeparture,
  type StopTime,
  StopDepartureQueryVars,
  stopDepartureQuery
} from './departure'
import { StopDepartureCache } from './departure-cache'
import {
  type Stop,
  type StopGql,
  stopQuery,
  stopSetDerived
} from './stop'
import { type Agency } from './agency'
import {
  type Route,
  type RouteGql,
  routeSetDerived,
  routeQuery,
  newRouteHeadwaySummary
} from './route'

/**
 * Feed data from GraphQL
 */
export interface FeedVersion {
  id: string
  sha1: string
}

export interface FeedGql {
  id: string
  onestop_id: string
  feed_state: {
    feed_version: FeedVersion
  }
}

/**
 * GraphQL query for feed versions
 */
export const feedVersionQuery = gql`
query ($where: FeedFilter) {
  feeds(where: $where) {
    id
    onestop_id
    feed_state {
      feed_version {
        id
        sha1
      }
    }
  }
}`

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
export interface ScenarioResult {
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
  stopDepartureProgress: { total: number, queue: number }
  feedVersionProgress: { total: number, completed: number }
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'complete'
  error?: any
}

/**
 * Callback interface for scenario fetching events
 */
export interface ScenarioCallbacks {
  onProgress?: (progress: ScenarioProgress) => void
  onComplete?: (result: ScenarioResult) => void
  onError?: (error: any) => void
}

/**
 * Interface for GraphQL client
 * Implementations should provide the actual GraphQL query execution
 */
export interface GraphQLClient {
  query<T = any>(query: any, variables?: any): Promise<{ data?: T }>
}

/**
 * Main class for fetching scenario data independent of Vue
 */
export class ScenarioFetcher {
  private config: ScenarioConfig
  private callbacks: ScenarioCallbacks
  private client: GraphQLClient
  
  // Internal state
  private stopDepartureCache = new StopDepartureCache()
  private stopDepartureLoadingComplete = false
  private activeStopDepartureQueryCount = 0
  private stopLimit = 100
  private stopTimeBatchSize = 100
  
  // Results
  private stopResultFixed: StopGql[] = []
  private routeResultFixed: RouteGql[] = []
  private feedVersions: FeedVersion[] = []
  private feedVersionProgress = { total: 0, completed: 0 }
  
  constructor(
    config: ScenarioConfig,
    client: GraphQLClient,
    callbacks: ScenarioCallbacks = {}
  ) {
    this.config = config
    this.callbacks = callbacks
    this.client = client
    this.stopLimit = config.stopLimit ?? 100
  }

  async fetch(): Promise<ScenarioResult> {
    try {
      return await this.fetchInner()
    } catch (error) {
      this.callbacks.onError?.(error)
      throw error
    }
  }

  // Start the scenario fetching process
  async fetchInner(): Promise<ScenarioResult> {
    this.emitProgress({ 
      isLoading: true, 
      stopDepartureProgress: { total: 0, queue: 0 },
      feedVersionProgress: { total: 0, completed: 0 },
      currentStage: 'feed-versions'
    })
    
    // Reset state
    this.stopResultFixed = []
    this.routeResultFixed = []
    this.feedVersions = []
    this.stopDepartureCache = new StopDepartureCache()
    this.stopDepartureLoadingComplete = false
    this.activeStopDepartureQueryCount = 0
    
    // FIRST STAGE: Fetch active feed versions in the area
    console.log('Starting feed version discovery...')
    await this.fetchFeedVersions()
    console.log('Feed version discovery completed:', this.feedVersions.length, 'feed versions')
    
    // SECOND STAGE: Fetch stops for each feed version
    this.emitProgress({ 
      isLoading: true, 
      stopDepartureProgress: { total: 0, queue: 0 },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'stops'
    })
    
    console.log('Starting stop fetching for', this.feedVersions.length, 'feed versions...')
    await this.fetchStopsForAllFeedVersions()
    console.log('Stop fetching completed with', this.stopResultFixed.length, 'stops')
    
    // THIRD STAGE: Wait for all stop departure queries to complete
    this.emitProgress({ 
      isLoading: true, 
      stopDepartureProgress: { total: 0, queue: this.activeStopDepartureQueryCount },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'schedules'
    })
    
    console.log('Starting stop departure queries...')
    await this.waitForStopDeparturesComplete()
    console.log('All stop departure queries completed')
    
    // FINAL STAGE: Apply filters and build final result
    this.emitProgress({ 
      isLoading: true, 
      stopDepartureProgress: { total: 0, queue: 0 },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'complete'
    })
    
    const result = this.buildResult()
    console.log('Scenario fetch complete')

    this.emitProgress({ 
      isLoading: false, 
      stopDepartureProgress: { total: 0, queue: 0 },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'complete'
    })
    this.callbacks.onComplete?.(result)
    
    return result
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions(): Promise<void> {
    console.log('fetchFeedVersions: starting')
    const bbox = this.config.bbox
    const variables = {
      where: {bbox:{
        min_lon: bbox ? bbox.sw.lon : null,
        min_lat: bbox ? bbox.sw.lat : null,
        max_lon: bbox ? bbox.ne.lon : null,
        max_lat: bbox ? bbox.ne.lat : null  
      }}
    }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedData: FeedGql[] = response.data?.feeds || []
    
    // Filter by selected feed versions if specified
    this.feedVersions = feedData.map(feed => feed.feed_state.feed_version)  
    this.feedVersionProgress = { total: this.feedVersions.length, completed: 0 }
    console.log('fetchFeedVersions: completed with', this.feedVersions.length, 'feed versions')
  }

  // Fetch stops for all feed versions
  private async fetchStopsForAllFeedVersions(): Promise<void> {
    const promises = this.feedVersions.map(feedVersion => 
      this.fetchStopsForFeedVersion(feedVersion)
    )
    await Promise.all(promises)
  }

  // Fetch stops for a specific feed version
  private async fetchStopsForFeedVersion(feedVersion: FeedVersion): Promise<void> {
    console.log('fetchStopsForFeedVersion: starting for', feedVersion.sha1)
    await this.fetchStops({ 
      after: 0, 
      feedVersionSha1: feedVersion.sha1 
    })
    this.feedVersionProgress.completed += 1
    this.emitProgress({ 
      isLoading: true, 
      stopDepartureProgress: { total: 0, queue: this.activeStopDepartureQueryCount },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'stops'
    })
    console.log('fetchStopsForFeedVersion: completed for', feedVersion.sha1)
  }

  // Fetch stops from GraphQL API
  private async fetchStops(task: { after: number, feedVersionSha1?: string }): Promise<void> {
    console.log('fetchStops: run', task)
    
    const bbox = this.config.bbox
    const b = bbox == null
      ? null
      : {
          min_lon: bbox.sw.lon,
          min_lat: bbox.sw.lat,
          max_lon: bbox.ne.lon,
          max_lat: bbox.ne.lat
        }
    const geoIds = this.config.geographyIds || []
    const variables = {
      after: task.after,
      limit: this.stopLimit,
      where: {
        location_type: 0,
        // Add feed version filtering
        feed_version_sha1: task.feedVersionSha1,
        location: {
          bbox: geoIds.length > 0 ? null : b,
          geography_ids: geoIds.length > 0 ? geoIds : null,
        }
      }
    }
    const response = await this.client.query<{ stops: StopGql[] }>(stopQuery, variables)
    
    console.log('fetchStops: resolved')
    const stopData: StopGql[] = response.data?.stops || []
    
    // Add to results
    this.stopResultFixed.push(...stopData)
    
    // Extract route IDs and fetch routes
    const routeIds: Set<number> = new Set()
    for (const stop of stopData) {
      for (const rs of stop.route_stops || []) {
        routeIds.add(rs.route?.id)
      }
    }
    
    if (routeIds.size > 0) {
      await this.fetchRoutes({ ids: [...routeIds] })
    }

    // Enqueue stop departure fetching
    const ids = stopData.map(s => s.id)
    this.enqueueStopDepartureFetch(ids)
    
    // Continue fetching more stops only if we got a full batch
    // If we got fewer than the limit, we've reached the end
    if (stopData.length >= this.stopLimit && ids.length > 0) {
      await this.fetchStops({ 
        after: ids[ids.length - 1], 
        feedVersionSha1: task.feedVersionSha1 
      })
    } else {
      console.log('fetchStops: completed for feed version', task.feedVersionSha1)
    }
  }

  // Fetch routes from GraphQL API
  private async fetchRoutes(task: { ids: number[] }): Promise<void> {
    console.log('fetchRoutes: run', task)
    
    const currentRouteIds = new Set<number>(this.routeResultFixed.map(r => r.id))
    const fetchRouteIds = task.ids.filter(id => !currentRouteIds.has(id))
    if (fetchRouteIds.length === 0) {
      return
    }
    
    const response = await this.client.query<{ routes: RouteGql[] }>(routeQuery, { ids: fetchRouteIds })
    
    console.log('fetchRoutes: resolved')
    const routeData: RouteGql[] = response.data?.routes || []
    
    // Merge with existing routes
    const routeIdx = new Map<number, RouteGql>()
    for (const route of this.routeResultFixed) {
      routeIdx.set(route.id, route)
    }
    for (const route of routeData) {
      routeIdx.set(route.id, route)
    }
    
    console.log('fetchRoutes: resolved')
    this.routeResultFixed = [...routeIdx.values()]
  }

  // Fetch stop departures from GraphQL API
  private async fetchStopDepartures(task: StopDepartureQueryVars): Promise<void> {
    if (task.ids.length === 0) {
      return
    }
    
    if (!this.config.scheduleEnabled) {
      console.log('schedule loading disabled, skipping departure queue')
      this.activeStopDepartureQueryCount -= 1
      return
    }

    console.log('fetchStopDepartures: run', task)
    
    const response = await this.client.query<{ stops: StopDeparture[] }>(stopDepartureQuery, task)
    
    // Update cache
    this.activeStopDepartureQueryCount -= 1
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
    
    this.stopDepartureCache.debugStats()
    
    // Update progress
    this.emitProgress({
      isLoading: this.activeStopDepartureQueryCount > 0,
      stopDepartureProgress: { total: 0, queue: this.activeStopDepartureQueryCount },
      feedVersionProgress: this.feedVersionProgress,
      currentStage: 'schedules'
    })
  }

  // Enqueue stop departure fetching tasks
  private enqueueStopDepartureFetch(stopIds: number[]): void {
    if (stopIds.length === 0) {
      return
    }
    
    const dates = this.getSelectedDateRange()
    const weekSize = 7
    
    for (let sid = 0; sid < stopIds.length; sid += this.stopTimeBatchSize) {
      for (let i = 0; i < dates.length; i += weekSize) {
        const w = new StopDepartureQueryVars()
        w.ids = stopIds.slice(sid, sid + this.stopTimeBatchSize)
        for (const d of dates.slice(i, i + weekSize)) {
          w.setDay(d)
        }
        this.activeStopDepartureQueryCount += 1
        
        // Execute the stop departure fetch
        this.fetchStopDepartures(w).catch(error => {
          this.callbacks.onError?.(error)
        })
      }
    }
  }

  // Get the selected date range
  private getSelectedDateRange(): Date[] {
    const sd = new Date((this.config.startDate || new Date()).valueOf())
    const ed = new Date((this.config.endDate || new Date()).valueOf())
    const dates = []
    while (sd <= ed) {
      dates.push(new Date(sd.valueOf()))
      sd.setDate(sd.getDate() + 1)
    }
    return dates
  }

  // Wait for all stop departure queries to complete
  private async waitForStopDeparturesComplete(): Promise<void> {
    return new Promise((resolve) => {
      console.log('Waiting for stop departure queries to complete...')
      const checkComplete = () => {
        if (this.activeStopDepartureQueryCount === 0) {
          this.stopDepartureLoadingComplete = true
          console.log('All stop departure queries completed')
          resolve()
        } else {
          console.log('Active stop departure queries:', this.activeStopDepartureQueryCount)
          setTimeout(checkComplete, 100)
        }
      }
      checkComplete()
    })
  }

  // Build the final result with filtered data
  private buildResult(): ScenarioResult {
    const selectedDayOfWeekModeValue = this.config.selectedDayOfWeekMode || ''
    const selectedDateRangeValue = this.getSelectedDateRange()
    const selectedDaysValue = this.config.selectedDays || []
    const selectedRouteTypesValue = this.config.selectedRouteTypes || []
    const selectedAgenciesValue = this.config.selectedAgencies || []
    const sdCache = this.stopDepartureLoadingComplete ? this.stopDepartureCache : null
    const startTimeValue = this.config.startTime ? format(this.config.startTime, 'HH:mm:ss') : '00:00:00'
    const endTimeValue = this.config.endTime ? format(this.config.endTime, 'HH:mm:ss') : '24:00:00'
    const frequencyUnderValue = (this.config.frequencyUnderEnabled ? this.config.frequencyUnder : -1) || -1
    const frequencyOverValue = (this.config.frequencyOverEnabled ? this.config.frequencyOver : -1) || -1

    // Apply route filters
    const routeFeatures: Route[] = []
    for (const routeGql of this.routeResultFixed || []) {
      const route: Route = {
        ...routeGql,
        route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
        agency_name: routeGql.agency?.agency_name || 'Unknown',
        route_mode: this.getRouteMode(routeGql.route_type),
        marked: true,
        average_frequency: null,
        fastest_frequency: null,
        slowest_frequency: null,
        headways: newRouteHeadwaySummary(),
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
      routeFeatures.push(route)
    }
    const markedRoutes = new Set(routeFeatures.filter(r => r.marked).map(r => r.id))

    // Apply stop filters
    const stopFeatures: Stop[] = []
    for (const stopGql of this.stopResultFixed) {
      const stop: Stop = {
        ...stopGql,
        marked: true,
        visits: null,
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
      stopFeatures.push(stop)
    }

    // Apply agency filters
    const agencyFeatures = this.buildAgencyFeatures(stopFeatures, routeFeatures)

    return {
      routes: routeFeatures,
      stops: stopFeatures,
      agencies: agencyFeatures,
      stopDepartureCache: this.stopDepartureCache,
      isComplete: this.stopDepartureLoadingComplete,
      feedVersions: this.feedVersions
    }
  }

  // Build agency features from stops and routes
  private buildAgencyFeatures(stopFeatures: Stop[], routeFeatures: Route[]): Agency[] {
    const agencyData = new Map()
    for (const stop of stopFeatures) {
      for (const rstop of stop.route_stops || []) {
        const agency = rstop.route.agency
        const aid = agency?.agency_id
        if (!aid) {
          continue
        }
        let adata = agencyData.get(aid) || {
          id: aid,
          routes: new Set(),
          routes_modes: new Set(),
          stops: new Set(),
          agency: agency
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
    return agencyDataValues.map((adata): Agency => {
      const agency = adata.agency as Agency
      return {
        marked: markedAgencies.has(agency.id),
        routes_count: adata.routes.size,
        routes_modes: [...adata.routes_modes].map((r: number) => this.getRouteMode(r)).join(', '),
        stops_count: adata.stops.size,
        id: agency.id,
        agency_id: agency.agency_id,
        agency_name: agency.agency_name,
        agency_email: agency.agency_email,
        agency_fare_url: agency.agency_fare_url,
        agency_lang: agency.agency_lang,
        agency_phone: agency.agency_phone,
        agency_timezone: agency.agency_timezone,
      }
    })
  }

  // Get route mode from route type
  private getRouteMode(routeType: number): string {
    return routeTypes.get(routeType) || 'Unknown'
  }

  // Emit progress updates
  private emitProgress(progress: ScenarioProgress): void {
    this.callbacks.onProgress?.(progress)
  }

  // Update configuration
  updateConfig(config: Partial<ScenarioConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // Get current configuration
  getConfig(): ScenarioConfig {
    return { ...this.config }
  }
}
