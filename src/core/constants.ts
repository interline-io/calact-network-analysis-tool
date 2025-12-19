/**
 * Grouped defaults for scenario and WSDOT configurations.
 * Use this to avoid importing individual constants.
 * Property names match WSDOTReportConfig for easy spreading.
 */
export const SCENARIO_DEFAULTS = {
  tableDatasetName: 'acsdt5y2021',
  geoDatasetName: 'tiger2021',
  tableDatasetTable: 'b01001',
  tableDatasetTableCol: 'b01001_001',
  geoDatasetLayer: 'tract',
  aggregateLayer: 'state',
  routeHourCompatMode: true,
  stopLimit: 100,
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

/**
 * Legacy color array for backward compatibility
 * For new code, prefer using categoricalColors from colors.ts
 * which uses d3-scale-chromatic for better color schemes
 */
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

export type Weekday = typeof dowValues[number]

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

export type RouteColorMode = typeof routeColorModes[number]

export const dataDisplayModes = [
  'Agency',
  'Route',
  'Stop',
  'Area',
] as const

export type DataDisplayMode = typeof dataDisplayModes[number]

export const weekdayModes = [
  'All',
  'Any',
] as const

export type WeekdayMode = typeof weekdayModes[number]

export const timeOfDayModes = [
  'All',
  'Partial',
] as const

export type TimeOfDayMode = typeof timeOfDayModes[number]

export const baseMapStyles = [
  { name: 'Streets', icon: 'map-search', available: true },
  { name: 'Satellite', icon: 'satellite', available: false },
] as const

// Flex Services (DRT/Demand-Responsive Transit) constants
// Maps to GTFS-Flex extension fields from booking_rules.txt, stop_times.txt, and locations.geojson
// See: https://github.com/google/transit/blob/master/gtfs/spec/en/reference.md
// TODO: Connect to transitland-server GraphQL resolvers when implemented
// Related PR: https://github.com/interline-io/transitland-lib/pull/527

/**
 * Advance notice categories for flex/DRT services.
 * Maps to booking_rules.booking_type field in GTFS-Flex:
 *   0 = Real time booking (On-Demand)
 *   1 = Up to same-day booking with advance notice (Same Day)
 *   2 = Up to prior day(s) booking (More than 24 hours)
 */
export const flexAdvanceNoticeTypes = [
  'On-demand', // booking_type = 0: Real time booking
  'Same day', // booking_type = 1: Up to same-day booking with advance notice
  'More than 24 hours', // booking_type = 2: Up to prior day(s) booking
] as const

export type FlexAdvanceNoticeType = typeof flexAdvanceNoticeTypes[number]

/**
 * Maps advance notice UI labels to GTFS-Flex booking_type values
 */
export const flexAdvanceNoticeToBookingType: Record<FlexAdvanceNoticeType, number> = {
  'On-demand': 0,
  'Same day': 1,
  'More than 24 hours': 2,
}

/**
 * Pickup/Dropoff area types for flex services.
 * Based on pickup_type and drop_off_type fields in stop_times.txt:
 *
 * pickup_type/drop_off_type values in GTFS-Flex:
 *   0 = Regularly scheduled (not flex)
 *   1 = Not available
 *   2 = Must coordinate with driver/operator (flex service)
 *   3 = Must coordinate with driver (rare)
 *
 * Filter logic:
 *   - PU only: pickup_type = 2, drop_off_type = 1 (for all instances of location_id)
 *   - DO only: pickup_type = 1, drop_off_type = 2
 *   - PU and DO: Areas where both pickup and dropoff are available within the area.
 *     This includes entries where pickup_type = 2 AND drop_off_type = 2,
 *     or multiple entries for the same location_id with mixed types.
 */
export const flexAreaTypes = [
  'PU only', // Only pickups available (pickup_type=2, drop_off_type=1)
  'DO only', // Only dropoffs available (pickup_type=1, drop_off_type=2)
  'PU and DO', // Both pickup and dropoff available within area
] as const

export type FlexAreaType = typeof flexAreaTypes[number]

/**
 * Color/styling modes for flex service areas on the map
 */
export const flexColorByModes = [
  'Agency', // Color areas by operating agency
  'Advance notice', // Color areas by booking_type category
  // TODO: Future feature - add 'Service Quality' option using
  // safe_duration_factor and safe_duration_offset for heatmap styling
] as const

export type FlexColorByMode = typeof flexColorByModes[number]
