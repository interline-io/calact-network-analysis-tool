import { gql } from 'graphql-tag'
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
import type { Agency } from './agency'
import {
  type Route,
  type RouteGql,
  routeSetDerived,
  routeQuery,
  newRouteHeadwaySummary
} from './route'
import { type dow, routeTypes } from '~/src/constants'
import type { Bbox } from '~/src/geom'

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
        feed {
          id
          onestop_id
        }
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

export interface ScenarioFilterResult {
  routes: Route[]
  stops: Stop[]
  agencies: Agency[]
  stopDepartureCache: StopDepartureCache
  isComplete: boolean
  feedVersions: FeedVersion[]
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

/**
 * Progress information for scenario fetching
 */
export interface ScenarioProgress {
  isLoading: boolean
  stopDepartureProgress: { total: number, completed: number }
  feedVersionProgress: { total: number, completed: number }
  currentStage: 'feed-versions' | 'stops' | 'routes' | 'schedules' | 'complete' | 'ready'
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
  onComplete?: (result: ScenarioData) => void
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
  private stopLimit = 1000
  private stopTimeBatchSize = 100
  private feedVersionProgress = { total: 0, completed: 0 }
  private stopDepartureProgress = { total: 0, completed: 0 }

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
  }

  async fetch (): Promise<ScenarioData> {
    try {
      return await this.fetchInner()
    } catch (error) {
      this.callbacks.onError?.(error)
      throw error
    }
  }

  // Start the scenario fetching process
  private async fetchInner (): Promise<ScenarioData> {
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
      await Promise.all(this.feedVersions.map(feedVersion => (this.fetchFeedVersionStops(feedVersion))))
      console.log(`Fetched ${this.stopResults.length} stops and ${this.routeResults.length} routes`)
    })

    // THIRD STAGE: Wait for all stop departure queries to complete
    await this.wrapTimer('Schedule queries', 'schedules', async () => {
      await this.waitForStopDeparturesComplete()
    })
    this.stopDepartureCache.debugStats()

    // FINAL STAGE: Apply filters and build final result
    const result: ScenarioData = {
      routes: this.routeResults,
      stops: this.stopResults,
      feedVersions: this.feedVersions,
      stopDepartureCache: this.stopDepartureCache,
      isComplete: true
    }
    this.callbacks.onComplete?.(result)
    this.updateProgress('complete', false)
    console.log(`🎉 Scenario complete: ${this.stopResults.length} stops, ${this.routeResults.length} routes`)
    return result
  }

  // Fetch active feed versions in the specified area
  private async fetchFeedVersions (): Promise<void> {
    const variables = { where: { bbox: convertBbox(this.config.bbox) } }
    const response = await this.client.query<{ feeds: FeedGql[] }>(feedVersionQuery, variables)
    const feedData: FeedGql[] = response.data?.feeds || []
    this.feedVersions = feedData.map(feed => feed.feed_state.feed_version)
    this.feedVersionProgress = { total: this.feedVersions.length, completed: 0 }
  }

  // Fetch stops for a specific feed version
  private async fetchFeedVersionStops (feedVersion: FeedVersion): Promise<void> {
    await this.fetchStops({ after: 0, feedOnestopId: feedVersion.feed.onestop_id, feedVersionSha1: feedVersion.sha1 })
    this.feedVersionProgress.completed += 1
    this.updateProgress('stops', true)
  }

  // Fetch stops from GraphQL API
  private async fetchStops (task: { after: number, feedOnestopId: string, feedVersionSha1: string }): Promise<void> {
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

    // Extract route IDs and fetch routes
    const routeIds: Set<number> = new Set()
    for (const stop of stopData) {
      for (const rs of stop.route_stops || []) {
        routeIds.add(rs.route?.id)
      }
    }

    // Fetch routes syncronously
    if (routeIds.size > 0) {
      await this.fetchRoutes({ feedOnestopId: task.feedOnestopId, feedVersionSha1: task.feedVersionSha1, ids: [...routeIds] })
    }

    // Enqueue stop departure fetching
    const stopIds = stopData.map(s => s.id)
    await this.enqueueStopDepartureFetch(stopIds)

    // Update incremental progress
    this.updateProgress('stops', true)

    // Continue fetching more stops only if we got a full batch
    // If we got fewer than the limit, we've reached the end
    if (stopData.length >= this.stopLimit && stopIds.length > 0) {
      await this.fetchStops({
        after: stopIds[stopIds.length - 1],
        feedOnestopId: task.feedOnestopId,
        feedVersionSha1: task.feedVersionSha1
      })
      return
    }
  }

  // Fetch routes from GraphQL API
  private async fetchRoutes (task: { feedOnestopId: string, feedVersionSha1: string, ids: number[] }): Promise<void> {
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
  }

  // Fetch stop departures from GraphQL API
  private async fetchStopDepartures (task: StopDepartureQueryVars): Promise<void> {
    if (!this.config.scheduleEnabled || task.ids.length === 0) {
      this.stopDepartureProgress.completed += 1
      this.updateProgress('schedules', true)
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

    // Update progress
    // this.stopDepartureCache.debugStats()
    this.stopDepartureProgress.completed += 1
    this.updateProgress('schedules', true)
  }

  // Enqueue stop departure fetching tasks
  private async enqueueStopDepartureFetch (stopIds: number[]): Promise<void> {
    if (stopIds.length === 0) {
      return
    }
    const dates = getSelectedDateRange(this.config)
    const weekSize = 7
    for (let sid = 0; sid < stopIds.length; sid += this.stopTimeBatchSize) {
      for (let i = 0; i < dates.length; i += weekSize) {
        const w = new StopDepartureQueryVars()
        w.ids = stopIds.slice(sid, sid + this.stopTimeBatchSize)
        for (const d of dates.slice(i, i + weekSize)) {
          w.setDay(d)
        }
        // Execute the stop departure fetch
        this.stopDepartureProgress.total += 1
        await this.fetchStopDepartures(w).catch((error) => {
          this.callbacks.onError?.(error)
        })
      }
    }
  }

  // Wait for all stop departure queries to complete
  private async waitForStopDeparturesComplete (): Promise<void> {
    return new Promise((resolve) => {
      console.log('Waiting for stop departure queries to complete...')
      const checkComplete = () => {
        if (this.stopDepartureProgress.total === this.stopDepartureProgress.completed) {
          console.log('All stop departure queries completed')
          resolve()
        } else {
          console.log('Remaining stop departure queries:', this.stopDepartureProgress.total - this.stopDepartureProgress.completed)
          setTimeout(checkComplete, 100)
        }
      }
      checkComplete()
    })
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
    const progress: ScenarioProgress = {
      isLoading: loading,
      stopDepartureProgress: this.stopDepartureProgress,
      feedVersionProgress: this.feedVersionProgress,
      currentStage: stage,
      partialData: {
        stops: this.stopResults,
        routes: this.routeResults,
        feedVersions: this.feedVersions
      }
    }
    this.callbacks.onProgress?.(progress)
  }
}

function _getRouteMode (routeType: number): string {
  return routeTypes.get(routeType) || 'Unknown'
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
