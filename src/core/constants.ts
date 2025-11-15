export const DEFAULT_CENSUS_DATASET = 'acsdt5y2021'
export const DEFAULT_GEODATA_DATASET = 'tiger2021'
export const DEFAULT_TABLE_DATASET_TABLE = 'b01001'
export const DEFAULT_TABLE_DATASET_TABLE_COL = 'b01001_001'
export const DEFAULT_GEO_DATASET_LAYER = 'tract'
export const DEFAULT_AGGREGATE_LAYER = 'state'

/**
 * Grouped defaults for scenario and WSDOT configurations.
 * Use this to avoid importing individual constants.
 * Property names match WSDOTReportConfig for easy spreading.
 */
export const SCENARIO_DEFAULTS = {
  tableDatasetName: DEFAULT_CENSUS_DATASET,
  geoDatasetName: DEFAULT_GEODATA_DATASET,
  tableDatasetTable: DEFAULT_TABLE_DATASET_TABLE,
  tableDatasetTableCol: DEFAULT_TABLE_DATASET_TABLE_COL,
  geoDatasetLayer: DEFAULT_GEO_DATASET_LAYER,
  aggregateLayer: DEFAULT_AGGREGATE_LAYER,
  routeHourCompatMode: true,
  scheduleEnabled: true,
  stopLimit: 1000,
  stopBufferRadius: 0,
} as const

export interface CannedBbox {
  label: string
  bboxString: string
}

export const cannedBboxes: Record<string, CannedBbox> = {
  'downtown-portland': { label: 'Downtown Portland, OR', bboxString: '-122.69075,45.51358,-122.66809,45.53306' },
  'downtown-portland-zoomed': { label: 'Downtown Portland, OR (zoomed)', bboxString: '-122.68308,45.52780,-122.68077,45.52932' },
  'greater-seattle': { label: 'Greater Seattle, WA', bboxString: '-124.876557,46.704561,-120.899506,49.018513' },
  'portland': { label: 'Portland, OR', bboxString: '-122.8,45.4,-122.5,45.7' },
  'greater-portland': { label: 'Greater Portland, OR', bboxString: '-124.545672,43.529645,-120.135723,46.549779' },
  'bend': { label: 'Bend, OR', bboxString: '-121.32895,44.04474,-121.29887,44.06547' },
  'eugene': { label: 'Eugene, OR', bboxString: '-123.11829,44.02712,-123.07870,44.05676' },
  'salem': { label: 'Salem, OR', bboxString: '-123.04563,44.93167,-123.01971,44.94815' },
  'wa': { label: 'Washington', bboxString: '-124.87621,45.17931,-116.41936,49.33295' },
  'wa+or': { label: 'Washington and Oregon', bboxString: '-127.300423,44.772916,-113.320321,47.625345' },
} as const

export enum RouteType {
  LightRail = 0,
  Subway = 1,
  IntercityRail = 2,
  Bus = 3,
  Ferry = 4,
}

export const routeTypeNames = new Map<RouteType, string>([
  [RouteType.LightRail, 'Light rail'],
  [RouteType.Subway, 'Subway'],
  [RouteType.IntercityRail, 'Intercity rail'],
  [RouteType.Bus, 'Bus'],
  [RouteType.Ferry, 'Ferry'],
])

export const colors = [
  '#e41a1c', // red
  '#ff7f00', // orange
  '#fee08b', // yellow
  '#1f78b4', // blue
  '#984ea3', // purple
  '#333333' // black
] as const

export const dowValues = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
] as const

export type dow = typeof dowValues[number]

export const geomSources = {
  mapExtent: 'Covering extent of map',
  bbox: 'Dragging bounding box',
  adminBoundary: 'Administrative Boundary',
} as const

export const routeColorModes = [
  'Mode',
  'Frequency',
  'Fare',
] as const

export const dataDisplayModes = [
  'Agency',
  'Route',
  'Stop',
] as const

export const selectedDayOfWeekModes = [
  'All',
  'Any',
] as const

export const selectedTimeOfDayModes = [
  'All',
  'Partial',
] as const

export const baseMapStyles = [
  { name: 'Streets', icon: 'map-search', available: true },
  { name: 'Satellite', icon: 'satellite', available: false },
] as const
