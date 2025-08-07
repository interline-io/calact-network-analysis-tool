import { type Bbox } from './geom'
import { type dow, routeTypes } from './constants'
import { format } from 'date-fns'
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
 * Configuration for scenario fetching
 */
export interface ScenarioConfig {
  bbox?: Bbox
  scheduleEnabled: boolean
  startDate?: Date
  endDate?: Date
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
  geographyIds?: number[]
  stopLimit?: number
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
}

/**
 * Progress information for scenario fetching
 */
export interface ScenarioProgress {
  isLoading: boolean
  stopDepartureProgress: { total: number, queue: number }
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
  private queryCount = 0
  private maxQueryLimit = 10000
  
  // Results
  private stopResultFixed: StopGql[] = []
  private routeResultFixed: RouteGql[] = []
  
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

  // Start the scenario fetching process
  async fetch(): Promise<ScenarioResult> {
    try {
      this.emitProgress({ isLoading: true, stopDepartureProgress: { total: 0, queue: 0 } })
      
      // Reset state
      this.stopResultFixed = []
      this.routeResultFixed = []
      this.stopDepartureCache = new StopDepartureCache()
      this.stopDepartureLoadingComplete = false
      this.activeStopDepartureQueryCount = 0
      this.queryCount = 0
      
      // Start fetching stops
      await this.fetchStops({ after: 0 })
      console.log('fetchStops: completed with', this.stopResultFixed.length, 'stops')

      // Validate that we found some stops
      if (this.stopResultFixed.length === 0) {
        throw new Error('No transit stops found in the specified geographic area. Please check your bounding box or geography IDs.')
      }
      
      // Wait for all stop departure queries to complete
      console.log('Starting stop departure queries...')
      await this.waitForStopDeparturesComplete()
      console.log('All stop departure queries completed')
      
      // Apply filters and build final result
      const result = this.buildResult()
      console.log('Scenario fetch complete:', result)

      this.emitProgress({ isLoading: false, stopDepartureProgress: { total: 0, queue: 0 } })
      this.callbacks.onComplete?.(result)
      
      return result
    } catch (error) {
      this.callbacks.onError?.(error)
      throw error
    }
  }

  // Get the computed stop variables for GraphQL query
  private getStopVars(after: number = 0) {
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
    return {
      after,
      limit: this.stopLimit,
      where: {
        location_type: 0,
        location: {
          bbox: geoIds.length > 0 ? null : b,
          geography_ids: geoIds.length > 0 ? geoIds : null,
        }
      }
    }
  }

  // Fetch stops from GraphQL API
  private async fetchStops(task: { after: number }): Promise<void> {
    console.log('fetchStops: run', task)
    this.checkQueryLimit()
    
    const variables = this.getStopVars(task.after)
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
      await this.fetchStops({ after: ids[ids.length - 1] })
    } else {
      console.log('fetchStops: completed - no more stops to fetch')
    }
  }

  // Fetch routes from GraphQL API
  private async fetchRoutes(task: { ids: number[] }): Promise<void> {
    console.log('fetchRoutes: run', task)
    this.checkQueryLimit()
    
    const currentRouteIds = new Set<number>(this.routeResultFixed.map(r => r.id))
    const taskRouteIds = new Set<number>(task.ids)
    const fetchRouteIds = task.ids.filter(id => !currentRouteIds.has(id))
    
    console.log('fetchRoutes: currentRouteIds:', currentRouteIds, 'taskIds:', taskRouteIds, 'fetchRouteIds', fetchRouteIds)
    
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
    
    console.log('fetchRoutes: resolved', '\nallRouteIds:', [...routeIdx.keys()])
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

    this.checkQueryLimit()
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
      stopDepartureProgress: { total: 0, queue: this.activeStopDepartureQueryCount }
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
      isComplete: this.stopDepartureLoadingComplete
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

  // Check query limits
  private checkQueryLimit(): void {
    this.queryCount += 1
    if (this.queryCount > this.maxQueryLimit) {
      console.log('Query limit exceeded')
      throw new Error('Query limit exceeded')
    }
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
