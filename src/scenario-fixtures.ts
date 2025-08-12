import { promises as fs } from 'fs'
import type { ScenarioData, ScenarioConfig, ScenarioFilter } from './scenario'
import { StopDepartureCache } from './departure-cache'
import type { StopTime } from './departure'

/**
 * Serializable representation of StopDepartureCache for JSON storage
 */
interface SerializableStopDepartureCache {
  cache: Array<[number, Array<[string, StopTime[]]>]>
  routeCache0: Array<[string, Array<[number, StopTime[]]>]>
  routeCache1: Array<[string, Array<[number, StopTime[]]>]>
}

/**
 * Serializable representation of ScenarioData for JSON storage
 */
interface SerializableScenarioData {
  routes: any[]
  stops: any[]
  feedVersions: any[]
  stopDepartureCache: SerializableStopDepartureCache
  isComplete: boolean
}

/**
 * Complete scenario test fixture including config, filter, and data
 */
export interface ScenarioTestFixture {
  config: ScenarioConfig
  filter: ScenarioFilter
  data: ScenarioData
}

/**
 * Serializable representation of complete scenario fixture
 */
interface SerializableScenarioTestFixture {
  config: SerializableScenarioConfig
  filter: SerializableScenarioFilter
  data: SerializableScenarioData
}

/**
 * Serializable representation of ScenarioConfig (handles Date serialization)
 */
interface SerializableScenarioConfig {
  bbox?: any
  scheduleEnabled: boolean
  startDate?: string // ISO string instead of Date
  endDate?: string // ISO string instead of Date
  geographyIds?: number[]
  stopLimit?: number
}

/**
 * Serializable representation of ScenarioFilter (handles Date serialization)
 */
interface SerializableScenarioFilter {
  startTime?: string // ISO string instead of Date
  endTime?: string // ISO string instead of Date
  selectedRouteTypes: number[]
  selectedDays: string[]
  selectedAgencies: string[]
  selectedDayOfWeekMode: string
  selectedTimeOfDayMode: string
  frequencyUnder?: number
  frequencyOver?: number
  frequencyUnderEnabled: boolean
  frequencyOverEnabled: boolean
}

/**
 * Save a complete scenario test fixture (config + filter + data) to a JSON file
 * @param fixture The complete test fixture to save
 * @param filePath The path where to save the JSON file
 */
export async function saveScenarioTestFixtureToFile (fixture: ScenarioTestFixture, filePath: string): Promise<void> {
  const serializable = serializeScenarioTestFixture(fixture)
  await fs.writeFile(filePath, JSON.stringify(serializable, null, 2), 'utf8')
}

/**
 * Load a complete scenario test fixture from a JSON file
 * @param filePath The path to the JSON file to load
 * @returns The deserialized test fixture
 */
export async function loadScenarioTestFixtureFromFile (filePath: string): Promise<ScenarioTestFixture> {
  const content = await fs.readFile(filePath, 'utf8')
  const serializable: SerializableScenarioTestFixture = JSON.parse(content)
  return deserializeScenarioTestFixture(serializable)
}

/**
 * Convert ScenarioData to a JSON-serializable format
 */
function serializeScenarioData (data: ScenarioData): SerializableScenarioData {
  return {
    routes: data.routes,
    stops: data.stops,
    feedVersions: data.feedVersions,
    stopDepartureCache: serializeStopDepartureCache(data.stopDepartureCache),
    isComplete: data.isComplete
  }
}

/**
 * Convert JSON-serializable format back to ScenarioData
 */
function deserializeScenarioData (serializable: SerializableScenarioData): ScenarioData {
  return {
    routes: serializable.routes,
    stops: serializable.stops,
    feedVersions: serializable.feedVersions,
    stopDepartureCache: deserializeStopDepartureCache(serializable.stopDepartureCache),
    isComplete: serializable.isComplete
  }
}

/**
 * Convert StopDepartureCache to a JSON-serializable format
 */
function serializeStopDepartureCache (cache: StopDepartureCache): SerializableStopDepartureCache {
  return {
    cache: Array.from(cache.cache.entries()).map(([stopId, dateMap]) => [
      stopId,
      Array.from(dateMap.entries())
    ]),
    routeCache0: Array.from(cache.routeCache0.cache.entries()).map(([key, stopMap]) => [
      key,
      Array.from(stopMap.entries())
    ]),
    routeCache1: Array.from(cache.routeCache1.cache.entries()).map(([key, stopMap]) => [
      key,
      Array.from(stopMap.entries())
    ])
  }
}

/**
 * Convert JSON-serializable format back to StopDepartureCache
 */
function deserializeStopDepartureCache (serializable: SerializableStopDepartureCache): StopDepartureCache {
  const cache = new StopDepartureCache()

  // Restore main cache
  cache.cache = new Map(
    serializable.cache.map(([stopId, dateEntries]) => [
      stopId,
      new Map(dateEntries)
    ])
  )

  // Restore route caches
  cache.routeCache0.cache = new Map(
    serializable.routeCache0.map(([key, stopEntries]) => [
      key,
      new Map(stopEntries)
    ])
  )

  cache.routeCache1.cache = new Map(
    serializable.routeCache1.map(([key, stopEntries]) => [
      key,
      new Map(stopEntries)
    ])
  )

  return cache
}

/**
 * Convert complete test fixture to a JSON-serializable format
 */
function serializeScenarioTestFixture (fixture: ScenarioTestFixture): SerializableScenarioTestFixture {
  return {
    config: serializeScenarioConfig(fixture.config),
    filter: serializeScenarioFilter(fixture.filter),
    data: serializeScenarioData(fixture.data)
  }
}

/**
 * Convert JSON-serializable format back to complete test fixture
 */
function deserializeScenarioTestFixture (serializable: SerializableScenarioTestFixture): ScenarioTestFixture {
  return {
    config: deserializeScenarioConfig(serializable.config),
    filter: deserializeScenarioFilter(serializable.filter),
    data: deserializeScenarioData(serializable.data)
  }
}

/**
 * Convert ScenarioConfig to a JSON-serializable format
 */
function serializeScenarioConfig (config: ScenarioConfig): SerializableScenarioConfig {
  return {
    bbox: config.bbox,
    scheduleEnabled: config.scheduleEnabled,
    startDate: config.startDate?.toISOString(),
    endDate: config.endDate?.toISOString(),
    geographyIds: config.geographyIds,
    stopLimit: config.stopLimit
  }
}

/**
 * Convert JSON-serializable format back to ScenarioConfig
 */
function deserializeScenarioConfig (serializable: SerializableScenarioConfig): ScenarioConfig {
  return {
    bbox: serializable.bbox,
    scheduleEnabled: serializable.scheduleEnabled,
    startDate: serializable.startDate ? new Date(serializable.startDate) : undefined,
    endDate: serializable.endDate ? new Date(serializable.endDate) : undefined,
    geographyIds: serializable.geographyIds,
    stopLimit: serializable.stopLimit
  }
}

/**
 * Convert ScenarioFilter to a JSON-serializable format
 */
function serializeScenarioFilter (filter: ScenarioFilter): SerializableScenarioFilter {
  return {
    startTime: filter.startTime?.toISOString(),
    endTime: filter.endTime?.toISOString(),
    selectedRouteTypes: filter.selectedRouteTypes,
    selectedDays: filter.selectedDays,
    selectedAgencies: filter.selectedAgencies,
    selectedDayOfWeekMode: filter.selectedDayOfWeekMode,
    selectedTimeOfDayMode: filter.selectedTimeOfDayMode,
    frequencyUnder: filter.frequencyUnder,
    frequencyOver: filter.frequencyOver,
    frequencyUnderEnabled: filter.frequencyUnderEnabled,
    frequencyOverEnabled: filter.frequencyOverEnabled
  }
}

/**
 * Convert JSON-serializable format back to ScenarioFilter
 */
function deserializeScenarioFilter (serializable: SerializableScenarioFilter): ScenarioFilter {
  return {
    startTime: serializable.startTime ? new Date(serializable.startTime) : undefined,
    endTime: serializable.endTime ? new Date(serializable.endTime) : undefined,
    selectedRouteTypes: serializable.selectedRouteTypes,
    selectedDays: serializable.selectedDays as any, // dow[] type
    selectedAgencies: serializable.selectedAgencies,
    selectedDayOfWeekMode: serializable.selectedDayOfWeekMode,
    selectedTimeOfDayMode: serializable.selectedTimeOfDayMode,
    frequencyUnder: serializable.frequencyUnder,
    frequencyOver: serializable.frequencyOver,
    frequencyUnderEnabled: serializable.frequencyUnderEnabled,
    frequencyOverEnabled: serializable.frequencyOverEnabled
  }
}
