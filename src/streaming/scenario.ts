/**
 * Unified streaming scenario implementation
 * Contains both client and server logic to prevent code rot
 */

import type { StopGql } from '~/src/stop'
import type { RouteGql } from '~/src/route'
import type { AgencyGql } from '~/src/agency'
import type { ScenarioConfig, ScenarioData } from '~/src/scenario'
import { StopDepartureCache } from '~/src/departure-cache'

// Re-export types for external consumption
export type { StopGql, RouteGql, AgencyGql, ScenarioConfig }

// ============================================================================
// SHARED TYPES
// ============================================================================

// Base streaming message interface
export interface StreamingMessage {
  type: 'progress' | 'stops_complete' | 'routes_complete' | 'departures_complete' | 'error'
  data: any
}

// Progress message during processing
export interface ProgressMessage extends StreamingMessage {
  type: 'progress'
  data: {
    phase: 'stops' | 'routes' | 'departures'
    current: number
    total: number
    message: string
  }
}

// Simple departure format for transport
export interface SimpleDeparture {
  stopId: number
  routeId: number
  tripId: number
  serviceDate: string // YYYY-MM-DD
  departureTime: number // seconds since midnight
  frequency?: number
  agencyId: number
  routeType: number
}

// Phase completion messages - using direct types without compression
export interface StopsCompleteMessage extends StreamingMessage {
  type: 'stops_complete'
  data: {
    stops: StopGql[]
    feedVersions: any[]
  }
}

export interface RoutesCompleteMessage extends StreamingMessage {
  type: 'routes_complete'
  data: {
    routes: RouteGql[]
    agencies: AgencyGql[]
  }
}

export interface DeparturesCompleteMessage extends StreamingMessage {
  type: 'departures_complete'
  data: {
    departures: SimpleDeparture[]
    summary: {
      totalStops: number
      totalRoutes: number
      totalDepartures: number
    }
  }
}

export interface ErrorMessage extends StreamingMessage {
  type: 'error'
  data: {
    message: string
    phase?: string
  }
}

// Union type for all possible messages
export type ScenarioStreamingMessage =
  | ProgressMessage
  | StopsCompleteMessage
  | RoutesCompleteMessage
  | DeparturesCompleteMessage
  | ErrorMessage

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

/**
 * Progress callback interface
 */
export interface ScenarioStreamingProgress {
  phase: 'stops' | 'routes' | 'departures'
  current: number
  total: number
  message: string
}

/**
 * Streaming scenario result
 */
export interface ScenarioStreamingResult {
  stops: StopGql[]
  routes: RouteGql[]
  agencies: AgencyGql[]
  scenarioData: ScenarioData | null
  isComplete: boolean
}

/**
 * Callback interface for streaming events
 */
export interface ScenarioStreamingCallbacks {
  onProgress?: (progress: ScenarioStreamingProgress) => void
  onStopsComplete?: (stops: StopGql[]) => void
  onRoutesComplete?: (routes: RouteGql[], agencies: AgencyGql[]) => void
  onDeparturesComplete?: (result: ScenarioStreamingResult) => void
  onError?: (error: Error) => void
}

/**
 * Client for streaming scenario data from server
 */
export class StreamingScenarioClient {
  private abortController: AbortController | null = null

  /**
   * Fetch scenario data using streaming
   */
  async fetchScenario (
    config: ScenarioConfig,
    callbacks: ScenarioStreamingCallbacks = {}
  ): Promise<ScenarioStreamingResult> {
    // Cancel any existing request
    if (this.abortController) {
      this.abortController.abort()
    }

    this.abortController = new AbortController()

    // Validate config
    if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
      throw new Error('Either bbox or geographyIds must be provided')
    }

    // Initialize accumulators
    let accumulatedStops: StopGql[] = []
    let accumulatedRoutes: RouteGql[] = []
    let accumulatedAgencies: AgencyGql[] = []
    let departureCache = new StopDepartureCache()
    let finalScenarioData: ScenarioData | null = null

    try {
      const response = await fetch('/api/scenario', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config),
        signal: this.abortController.signal
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

          try {
            const message = JSON.parse(line) as ScenarioStreamingMessage

            if (message.type === 'progress') {
              const progressMessage = message as ProgressMessage
              callbacks.onProgress?.(progressMessage.data)
            } else if (message.type === 'stops_complete') {
              const stopsMessage = message as StopsCompleteMessage
              accumulatedStops = stopsMessage.data.stops
              callbacks.onStopsComplete?.(accumulatedStops)
            } else if (message.type === 'routes_complete') {
              const routesMessage = message as RoutesCompleteMessage
              accumulatedRoutes = routesMessage.data.routes
              accumulatedAgencies = routesMessage.data.agencies
              callbacks.onRoutesComplete?.(accumulatedRoutes, accumulatedAgencies)
            } else if (message.type === 'departures_complete') {
              const departuresMessage = message as DeparturesCompleteMessage

              // Build departure cache from simplified departures
              departureCache = new StopDepartureCache()

              // Group departures by stop and date
              const departuresByStop = new Map<string, Map<string, any[]>>()
              for (const simpleDeparture of departuresMessage.data.departures) {
                const stopId = simpleDeparture.stopId.toString()
                const date = simpleDeparture.serviceDate

                if (!departuresByStop.has(stopId)) {
                  departuresByStop.set(stopId, new Map())
                }
                const stopDepartures = departuresByStop.get(stopId)!
                if (!stopDepartures.has(date)) {
                  stopDepartures.set(date, [])
                }

                // Create StopTime-like object
                const stopTime = {
                  departure_time: simpleDeparture.departureTime.toString(),
                  trip: {
                    id: simpleDeparture.tripId,
                    direction_id: 0, // Default - server should provide this
                    route: {
                      id: simpleDeparture.routeId
                    }
                  }
                }

                stopDepartures.get(date)!.push(stopTime)
              }

              // Add all departures to cache
              for (const [stopId, dateMap] of departuresByStop) {
                for (const [date, departures] of dateMap) {
                  departureCache.add(parseInt(stopId), date, departures)
                }
              }

              // Create final scenario data
              finalScenarioData = {
                routes: accumulatedRoutes,
                stops: accumulatedStops,
                feedVersions: [], // Will need to be included in earlier messages
                stopDepartureCache: departureCache,
                isComplete: true
              }

              const result: ScenarioStreamingResult = {
                stops: accumulatedStops,
                routes: accumulatedRoutes,
                agencies: accumulatedAgencies,
                scenarioData: finalScenarioData,
                isComplete: true
              }

              callbacks.onDeparturesComplete?.(result)
            } else if (message.type === 'error') {
              const errorMessage = message as ErrorMessage
              const error = new Error(errorMessage.data.message)
              callbacks.onError?.(error)
              throw error
            }
          } catch (parseError) {
            console.warn('Failed to parse streaming message:', line, parseError)
            // Continue processing other messages rather than failing completely
          }
        }
      }

      // Return final result
      return {
        stops: accumulatedStops,
        routes: accumulatedRoutes,
        agencies: accumulatedAgencies,
        scenarioData: finalScenarioData,
        isComplete: finalScenarioData !== null
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error('Request was cancelled')
      }
      callbacks.onError?.(error)
      throw error
    }
  }

  /**
   * Cancel the current request
   */
  cancel (): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Check if a request is currently in progress
   */
  get isLoading (): boolean {
    return this.abortController !== null
  }
}

// ============================================================================
// SERVER IMPLEMENTATION
// ============================================================================

/**
 * Server-side scenario processor
 * Integrates with the actual ScenarioFetcher to provide real streaming data
 */
export async function processStreamingScenario (
  config: ScenarioConfig,
  sendMessage: (message: ScenarioStreamingMessage) => void,
  sendProgress: (phase: string, current: number, total: number, message: string) => void
): Promise<void> {
  try {
    // Import ScenarioFetcher and GraphQLClient here to avoid circular dependencies
    const { ScenarioFetcher } = await import('~/src/scenario')
    const { BasicGraphQLClient } = await import('~/src/graphql')

    // Create GraphQL client - in a real server environment, these would come from config
    // For now, using the same endpoint as the test files
    const client = new BasicGraphQLClient(
      'https://transit.land/api/v2/query',
      process.env.TRANSITLAND_API_KEY || 'test-key'
    )

    // Create the ScenarioFetcher with streaming callbacks
    const scenarioFetcher = new ScenarioFetcher(config, client, {
      onProgress: (progress) => {
        // Map ScenarioProgress to our streaming progress format
        const phaseMap = {
          'feed-versions': 'stops',
          'stops': 'stops',
          'routes': 'routes',
          'schedules': 'departures',
          'complete': 'departures',
          'ready': 'stops'
        } as const

        const phase = phaseMap[progress.currentStage] || 'stops'

        if (progress.currentStage === 'stops' || progress.currentStage === 'feed-versions') {
          sendProgress(
            phase,
            progress.feedVersionProgress.completed,
            progress.feedVersionProgress.total,
            `Processing ${progress.currentStage}...`
          )
        } else if (progress.currentStage === 'schedules') {
          sendProgress(
            phase,
            progress.stopDepartureProgress.completed,
            progress.stopDepartureProgress.total,
            'Processing departures...'
          )
        }

        // Send intermediate data updates if available
        if (progress.partialData) {
          if (progress.partialData.stops.length > 0 && progress.currentStage === 'routes') {
            // Send stops complete when we start processing routes
            const stopsMessage: StopsCompleteMessage = {
              type: 'stops_complete',
              data: {
                stops: progress.partialData.stops,
                feedVersions: progress.partialData.feedVersions
              }
            }
            sendMessage(stopsMessage)
          }

          if (progress.partialData.routes.length > 0 && progress.currentStage === 'schedules') {
            // Send routes complete when we start processing schedules
            // Extract unique agencies from routes
            const agencyMap = new Map()
            for (const route of progress.partialData.routes) {
              if (route.agency) {
                agencyMap.set(route.agency.id, route.agency)
              }
            }
            const agencies = Array.from(agencyMap.values())

            const routesMessage: RoutesCompleteMessage = {
              type: 'routes_complete',
              data: {
                routes: progress.partialData.routes,
                agencies
              }
            }
            sendMessage(routesMessage)
          }
        }
      },
      onComplete: (result) => {
        // Convert StopDepartureCache to SimpleDeparture format for streaming
        const departures: SimpleDeparture[] = []

        // Get all cached departures and convert them
        const cache = result.stopDepartureCache
        for (const stop of result.stops) {
          // Get departure dates from config
          const startDate = config.startDate || new Date()
          const endDate = config.endDate || new Date()
          const currentDate = new Date(startDate)

          while (currentDate <= endDate) {
            const dateString = currentDate.toISOString().split('T')[0]
            const stopDepartures = cache.get(stop.id, dateString)

            if (stopDepartures) {
              for (const departure of stopDepartures) {
                departures.push({
                  stopId: stop.id,
                  routeId: departure.trip.route.id,
                  tripId: departure.trip.id,
                  serviceDate: dateString,
                  departureTime: parseInt(departure.departure_time),
                  agencyId: 0, // We'd need to get this from the route
                  routeType: 0 // We'd need to get this from the route
                })
              }
            }

            currentDate.setDate(currentDate.getDate() + 1)
          }
        }

        // Send departures complete
        const departuresMessage: DeparturesCompleteMessage = {
          type: 'departures_complete',
          data: {
            departures,
            summary: {
              totalStops: result.stops.length,
              totalRoutes: result.routes.length,
              totalDepartures: departures.length
            }
          }
        }
        sendMessage(departuresMessage)
      },
      onError: (error) => {
        console.error('ScenarioFetcher error:', error)
        const errorMessage: ErrorMessage = {
          type: 'error',
          data: { message: error.message || 'Unknown error in ScenarioFetcher' }
        }
        sendMessage(errorMessage)
      }
    })

    // Start the scenario fetching process
    await scenarioFetcher.fetch()
  } catch (error) {
    console.error('Error in processStreamingScenario:', error)
    const errorMessage: ErrorMessage = {
      type: 'error',
      data: { message: error instanceof Error ? error.message : 'Unknown error' }
    }
    sendMessage(errorMessage)
    throw error
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Convenience function to create a new streaming client and fetch scenario
 */
export async function fetchStreamingScenario (
  config: ScenarioConfig,
  callbacks: ScenarioStreamingCallbacks = {}
): Promise<ScenarioStreamingResult> {
  const client = new StreamingScenarioClient()
  return await client.fetchScenario(config, callbacks)
}
