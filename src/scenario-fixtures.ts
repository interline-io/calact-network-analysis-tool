import type { ScenarioData, ScenarioConfig, ScenarioFilter } from './scenario'
import { StopDepartureCache } from './departure-cache'
import type { StopTime } from './departure'
import { fmtTime, parseDate, fmtDate, parseTime } from '~/src/datetime'

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
export interface SerializableScenarioTestFixture {
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
  startDate?: string
  endDate?: string
  geographyIds?: number[]
  stopLimit?: number
}

/**
 * Serializable representation of ScenarioFilter (handles Date serialization)
 */
interface SerializableScenarioFilter {
  startTime?: string
  endTime?: string
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
export function serializeScenarioTestFixture (fixture: ScenarioTestFixture): SerializableScenarioTestFixture {
  return {
    config: serializeScenarioConfig(fixture.config),
    filter: serializeScenarioFilter(fixture.filter),
    data: serializeScenarioData(fixture.data)
  }
}

/**
 * Convert JSON-serializable format back to complete test fixture
 */
export function deserializeScenarioTestFixture (serializable: SerializableScenarioTestFixture): ScenarioTestFixture {
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
    startDate: fmtDate(config.startDate),
    endDate: fmtDate(config.endDate),
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
    startDate: parseDate(serializable.startDate || ''),
    endDate: parseDate(serializable.endDate || ''),
    geographyIds: serializable.geographyIds,
    stopLimit: serializable.stopLimit
  }
}

/**
 * Convert ScenarioFilter to a JSON-serializable format
 */
function serializeScenarioFilter (filter: ScenarioFilter): SerializableScenarioFilter {
  return {
    startTime: fmtTime(filter.startTime),
    endTime: fmtTime(filter.endTime),
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
    startTime: parseTime(serializable.startTime || ''),
    endTime: parseTime(serializable.endTime || ''),
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
