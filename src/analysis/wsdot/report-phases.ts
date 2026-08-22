// The WSDOT report's own pipeline phases, run after the fetch phases whose
// data they consume: 'wsdot-levels' classifies stops into service levels and
// builds the stop table; 'wsdot-geographies' fetches the per-level census
// population rollups. Both stream typed partialData payloads and phase
// progress, so consumers see them exactly like fetch phases.

import {
  fmtDate,
  parseCalendarDate,
  chunkArray,
  type GraphQLClient,
  type Geometry,
  type Bbox,
} from '~~/src/core'
import {
  phaseDone,
  type ResolvedGeographyContext,
  type ScenarioConfig,
  type ScenarioPhaseName,
  type ScenarioProgress,
} from '~~/src/scenario'
import { fetchCensusIntersection, type CensusGeographyFeature, type RouteGql } from '~~/src/tl'
import { SERVICE_LEVELS, processServiceLevel } from './service-levels'
import type { WSDOTFrequencyAggregator, FrequencyLabels } from './frequency'
import type { WSDOTStopCollector } from './stops'

// Batch sizes for streamed report payloads.
const PROGRESS_LIMIT_STOPS = 1000
const PROGRESS_LIMIT_BBOX_FEATURES = 100

// Scenario config plus the report's own dates, buffer, and census settings.
export interface WSDOTReportConfig extends ScenarioConfig {
  weekdayDate: Date
  weekendDate: Date
  stopBufferRadius: number
  tableDatasetName: string
  tableDatasetTable: string
  tableDatasetTableCol: string
  geoDatasetName: string
  geoDatasetLayer: string
  routeHourCompatMode: boolean
}

// The declared phase plan for both WSDOT reports: the fetch phases they read,
// then the report's own phases. What runs is exactly what is declared —
// browse-style derivation from config flags never applies.
export const WSDOT_PHASE_PLAN: ScenarioPhaseName[] = [
  'feed-versions', 'stops', 'routes', 'departures', 'wsdot-levels', 'wsdot-geographies',
]

// The calendar dates the report reads: the weekday, the weekend day, and the
// day after the weekday (whose early hours are the post-midnight half of the
// night segments). The config crosses a JSON boundary, so these arrive as
// strings at runtime despite the declared Date type.
export function wsdotReportDates (config: WSDOTReportConfig): Date[] {
  const weekday = configDate(config.weekdayDate)
  const overnight = new Date(weekday.valueOf())
  overnight.setDate(overnight.getDate() + 1)
  return [weekday, configDate(config.weekendDate), overnight]
}

// Shared with the scenario phases so both read a config date the same way.
function configDate (value: Date | string): Date {
  return parseCalendarDate(value) ?? new Date(value.valueOf())
}

// The calendar dates the departures phase must fetch for the report: the
// three report days plus the day before each, since a departure stated past
// 24:00:00 belongs to the next day — levelNights would otherwise miss late
// trips whose service date precedes the day being analyzed.
export function wsdotDepartureDates (config: WSDOTReportConfig): string[] {
  const dates = new Set<string>()
  for (const date of wsdotReportDates(config)) {
    const previous = new Date(date.valueOf())
    previous.setDate(previous.getDate() - 1)
    dates.add(fmtDate(previous))
    dates.add(fmtDate(date))
  }
  return [...dates].sort()
}

// The assembled report: the stop table, per-level stop ids, and the census
// geography rollups.
export interface WSDOTReport {
  stops: WSDOTStopResult[]
  levelStops: Record<string, number[]>
  levelLayers: Record<string, Record<string, GeographyDataFeature[]>>
  bboxIntersection: GeographyDataFeature[]
}

// One stop-table row, with per-level qualification flags.
export interface WSDOTStopResult {
  feedOnestopId: string
  feedVersionSha1: string
  stateName: string
  stopId: string
  stopName: string
  stopLat: number
  stopLon: number
  level6: boolean
  level5: boolean
  level4: boolean
  level3: boolean
  level2: boolean
  level1: boolean
  levelNights: boolean
  levelAll: boolean
}

// Adds pre-computed total_population/intersection_population from the
// configured tableDatasetTableCol on top of CensusGeographyFeature.
export interface GeographyDataFeature {
  id: string
  type: string
  properties: CensusGeographyFeature['properties'] & {
    total_population: number
    intersection_population: number
    [key: string]: any
  }
  geometry: Geometry | null
}

// The report's own stream payloads, typed here so src/scenario stays free of
// report-specific fields.
export interface WSDOTReportPartialData {
  // Chunks of the stop table.
  wsdotStops?: WSDOTStopResult[]
  // Level key -> qualifying stop ids, one level per event.
  wsdotLevelStops?: Record<string, number[]>
  // Per-level geography rollups, chunked; each entry carries one level+layer.
  wsdotLevelLayers?: { level: string, layer: string, features: GeographyDataFeature[] }[]
  // Tract features intersecting the search area (the population denominator).
  wsdotBboxIntersection?: GeographyDataFeature[]
}

// ScenarioProgress with the report's payloads layered onto partialData.
export interface WSDOTProgress extends ScenarioProgress {
  partialData?: ScenarioProgress['partialData'] & WSDOTReportPartialData
}

type WSDOTPhaseEmit = (progress: WSDOTProgress) => void | Promise<void>

// Folded records the levels phase classifies over.
export interface WSDOTLevelsInput {
  frequency: WSDOTFrequencyAggregator
  stops: WSDOTStopCollector
  // The scenario's routes; their id -> route_id pairs are the route domain
  // of the frequency maps.
  routes: RouteGql[]
}

// Level classifications plus the stop table built from them.
export interface WSDOTLevelsResult {
  // Level key -> qualifying stop ids, as sets for the geographies phase.
  levelSets: Record<string, Set<number>>
  levelStops: Record<string, number[]>
  stops: WSDOTStopResult[]
}

// Classify every stop into the WSDOT service levels and build the stop table,
// streaming both out in batches. Pure computation over the folded frequency
// counters — no requests.
export async function runWsdotLevelsPhase (
  config: WSDOTReportConfig,
  input: WSDOTLevelsInput,
  emit: WSDOTPhaseEmit,
): Promise<WSDOTLevelsResult> {
  await emit({
    currentStage: 'wsdot-levels',
    currentStageMessage: 'Computing WSDOT service levels...',
  })

  // Numeric id -> GTFS id for every stop and route the scenario fetched.
  // These are the domain the frequency maps are built over, so a stop with no
  // service still appears with empty counters.
  const routeGtfsIds = new Map<number, string>()
  for (const route of input.routes) {
    routeGtfsIds.set(route.id, route.route_id)
  }
  const labels: FrequencyLabels = { stopGtfsIds: input.stops.gtfsIds(), routeGtfsIds }

  const [weekdayDate, weekendDate, overnightDate] = wsdotReportDates(config)
  const weekdayFreq = buildFrequencyData(input.frequency, weekdayDate!, labels, 'weekday')
  const weekendFreq = buildFrequencyData(input.frequency, weekendDate!, labels, 'weekend')

  // Departures land on the calendar day they run, so the night that follows
  // the weekday is in the next day's data — its early hours feed levelNights.
  const overnightFreq = buildFrequencyData(input.frequency, overnightDate!, labels, 'overnight')
  if (input.frequency.departureCount(overnightDate!) === 0) {
    console.warn(`No departures on ${fmtDate(overnightDate)} — night service after ${fmtDate(weekdayDate)} cannot be evaluated`)
  }

  const levelSets: Record<string, Set<number>> = {}
  const levelStops: Record<string, number[]> = {}
  for (const [levelKey, levelConfig] of Object.entries(SERVICE_LEVELS)) {
    const qualifyingStops = processServiceLevel(levelConfig, weekdayFreq, weekendFreq, overnightFreq, config.routeHourCompatMode)
    levelSets[levelKey] = qualifyingStops
    levelStops[levelKey] = Array.from(qualifyingStops)
    console.log(`${levelKey}: ${qualifyingStops.size} qualifying stops`)
  }

  // Every stop in the scenario is listed; stops without geometry are skipped.
  const stops: WSDOTStopResult[] = []
  for (const stop of input.stops.all) {
    if (stop.lat === null || stop.lon === null) {
      continue
    }
    const stopId = stop.id
    stops.push({
      feedOnestopId: stop.feedOnestopId,
      feedVersionSha1: stop.feedVersionSha1,
      stateName: stop.stateName,
      stopId: stop.gtfsStopId,
      stopName: stop.stopName,
      stopLat: stop.lat,
      stopLon: stop.lon,
      level6: levelSets.level6?.has(stopId) || false,
      level5: levelSets.level5?.has(stopId) || false,
      level4: levelSets.level4?.has(stopId) || false,
      level3: levelSets.level3?.has(stopId) || false,
      level2: levelSets.level2?.has(stopId) || false,
      level1: levelSets.level1?.has(stopId) || false,
      levelNights: levelSets.levelNights?.has(stopId) || false,
      levelAll: true,
    })
  }

  // Streamed in batches, each awaited: emitting without waiting would encode
  // the whole table at once while its source objects are still live — too
  // much for a 128 MB Worker with the frequency maps also resident.
  const stopChunks = chunkArray(stops, PROGRESS_LIMIT_STOPS)
  for (let i = 0; i < stopChunks.length; i++) {
    await emit({
      currentStage: 'wsdot-levels',
      partialData: { wsdotStops: stopChunks[i] ?? [] },
      currentStageMessage: `WSDOT stops batch ${i + 1} of ${stopChunks.length}...`,
    })
  }
  for (const [levelKey, stopIds] of Object.entries(levelStops)) {
    await emit({
      currentStage: 'wsdot-levels',
      partialData: { wsdotLevelStops: { [levelKey]: stopIds } },
      currentStageMessage: `WSDOT service level stops for ${levelKey}...`,
    })
  }

  await emit({ currentStage: 'wsdot-levels', phaseProgress: phaseDone('wsdot-levels') })
  return { levelSets, levelStops, stops }
}

// One date's frequency maps, with a per-hour departure summary logged.
function buildFrequencyData (frequency: WSDOTFrequencyAggregator, date: Date, labels: FrequencyLabels, label: string) {
  const freq = frequency.build(date, labels)
  console.log(`Analyzed ${freq.stops.size} stops for ${label} ${fmtDate(date)} with ${frequency.departureCount(date)} departures`)
  const totals = frequency.hourlyTotals(date)
  for (let hour = 0; hour < totals.length; hour++) {
    console.log(`\thour ${hour}: ${totals[hour]} departures`)
  }
  return freq
}

// Level classifications plus the run's search area.
export interface WSDOTGeographiesInput {
  levelSets: Record<string, Set<number>>
  // From the feed-versions phase. The bbox tract query has no other spatial
  // filter, so an unresolved context would ask for every tract nationwide.
  resolved: ResolvedGeographyContext
}

// Fetch the report's census population rollups: search-area tract
// intersections, the state rollup, and per-level tract intersections of the
// qualifying stops' buffers. Each layer is sent and released as it arrives
// (the bbox set excepted — the report returns it); holding all eight
// statewide tract sets at once is what exhausted the Worker.
export async function runWsdotGeographiesPhase (
  config: WSDOTReportConfig,
  input: WSDOTGeographiesInput,
  client: GraphQLClient,
  emit: WSDOTPhaseEmit,
): Promise<{ bboxIntersection: GeographyDataFeature[] }> {
  const baseGeographyConfig: getGeographyDataConfig = {
    client,
    tableDatasetName: config.tableDatasetName,
    tableDatasetTable: config.tableDatasetTable,
    tableDatasetTableCol: config.tableDatasetTableCol,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.geoDatasetLayer,
  }

  const bufferRadius = config.stopBufferRadius || 0
  if (bufferRadius <= 0) {
    console.warn('[WSDOTGeographies] stopBufferRadius is zero or negative — skipping the per-level geography fetches')
  }

  // The task list up front, so progress counts the fetches honestly.
  const fetchBbox = !!(input.resolved.bbox || input.resolved.within)
  if (!fetchBbox) {
    console.warn('No search area resolved — skipping the bbox tract population, which would otherwise be unbounded')
  }
  const levelTasks: { level: string, layer: string, stopIds: Set<number> }[] = []
  // The state rollup (the viewer's population denominator) reads only
  // levelAll's, so one fetch answers it for every level.
  const allStops = input.levelSets.levelAll
  if (bufferRadius > 0 && allStops && allStops.size > 0) {
    levelTasks.push({ level: 'levelAll', layer: 'state', stopIds: allStops })
  }
  for (const [levelKey, stopIds] of Object.entries(input.levelSets)) {
    if (bufferRadius > 0 && stopIds.size > 0) {
      levelTasks.push({ level: levelKey, layer: 'tract', stopIds })
    }
  }

  const total = (fetchBbox ? 1 : 0) + levelTasks.length
  let completed = 0
  const progress = () => ({ phase: 'wsdot-geographies' as const, completed, total })

  // Bbox population (tract intersections), clipped to the resolved area.
  let bboxIntersection: GeographyDataFeature[] = []
  if (fetchBbox) {
    console.log(`Fetching tract populations for bbox...`)
    bboxIntersection = await getGeographyData({
      ...baseGeographyConfig,
      geoDatasetLayer: 'tract',
      bbox: input.resolved.bbox,
      within: input.resolved.within,
    })
    completed++
    const bboxChunks = chunkArray(bboxIntersection, PROGRESS_LIMIT_BBOX_FEATURES)
    for (let i = 0; i < bboxChunks.length; i++) {
      await emit({
        currentStage: 'wsdot-geographies',
        partialData: { wsdotBboxIntersection: bboxChunks[i] ?? [] },
        phaseProgress: progress(),
        currentStageMessage: `WSDOT bbox intersection batch ${i + 1} of ${bboxChunks.length}...`,
      })
    }
  }

  for (const task of levelTasks) {
    console.log(`Fetching geography data for ${task.level} layer ${task.layer} with ${task.stopIds.size} stop IDs`)
    const data = await getGeographyData({
      ...baseGeographyConfig,
      stopIds: task.stopIds,
      geoDatasetLayer: task.layer,
      stopBufferRadius: bufferRadius,
      // Only tract outlines are ever drawn, behind the stop-buffer toggle.
      includeIntersectionGeometry: task.layer === 'tract',
    })
    completed++
    const featureChunks = chunkArray(data, PROGRESS_LIMIT_STOPS)
    for (let i = 0; i < featureChunks.length; i++) {
      await emit({
        currentStage: 'wsdot-geographies',
        partialData: { wsdotLevelLayers: [{ level: task.level, layer: task.layer, features: featureChunks[i] ?? [] }] },
        phaseProgress: progress(),
        currentStageMessage: `WSDOT ${task.level} ${task.layer} batch ${i + 1} of ${featureChunks.length}...`,
      })
    }
  }

  await emit({ currentStage: 'wsdot-geographies', phaseProgress: phaseDone('wsdot-geographies') })
  return { bboxIntersection }
}

interface getGeographyDataConfig {
  client: GraphQLClient
  // Admin polygon for runs started from geography ids; takes precedence over
  // bbox in the query.
  within?: GeoJSON.Polygon
  tableDatasetName: string
  tableDatasetTable: string
  tableDatasetTableCol: string
  geoDatasetName: string
  geoDatasetLayer: string
  stopIds?: Set<number>
  stopBufferRadius?: number
  includeIntersectionGeometry?: boolean
  bbox?: Bbox
}

// Census intersection features with the configured population column
// pre-computed onto each one.
async function getGeographyData (
  config: getGeographyDataConfig,
): Promise<GeographyDataFeature[]> {
  const features = await fetchCensusIntersection({
    client: config.client,
    geoDatasetName: config.geoDatasetName,
    geoDatasetLayer: config.geoDatasetLayer,
    tableDatasetName: config.tableDatasetName,
    tableNames: [config.tableDatasetTable],
    bbox: config.bbox,
    within: config.within,
    stopIds: config.stopIds,
    stopBufferRadius: config.stopBufferRadius,
    includeIntersectionGeometry: config.includeIntersectionGeometry,
  })
  return features.map((f): GeographyDataFeature => {
    const totalPop = f.properties.values[config.tableDatasetTableCol] || 0
    return {
      ...f,
      properties: {
        ...f.properties,
        total_population: totalPop,
        intersection_population: totalPop * f.properties.intersection_ratio,
      },
    }
  })
}
