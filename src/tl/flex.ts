import { gql } from 'graphql-tag'
import { parseHMS } from '~~/src/core'

//////////
// Flex Services (DRT/Demand-Responsive Transit) Types
// Based on GTFS-Flex extension data structure
//
// GraphQL Schema Mapping (transitland-server):
// ============================================
//
// Location (GraphQL) -> FlexAreaFeature (this file)
//   - location.id -> feature.id
//   - location.location_id -> properties.location_id
//   - location.stop_name -> properties.location_name
//   - location.geometry -> feature.geometry
//   - location.feed_onestop_id -> (used for feed association)
//
// FlexStopTime (GraphQL) -> Aggregated into FlexAreaProperties
//   - stop_time.pickup_type -> properties.pickup_types[], pickup_available
//   - stop_time.drop_off_type -> properties.drop_off_types[], drop_off_available
//   - stop_time.start_pickup_drop_off_window -> properties.time_window_start
//   - stop_time.end_pickup_drop_off_window -> properties.time_window_end
//   - stop_time.pickup_booking_rule -> properties.pickup_booking_rules[]
//   - stop_time.drop_off_booking_rule -> properties.drop_off_booking_rules[]
//   - stop_time.trip.route.agency -> properties.agencies[]
//
// BookingRule (GraphQL) -> FlexBookingRule (this file)
//   - booking_rule.booking_type -> booking_type (0=realtime, 1=same-day, 2=prior-day)
//   - booking_rule.phone_number -> phone_number
//   - booking_rule.info_url -> info_url
//   - booking_rule.message -> message
//
// The transformation is implemented below:
//   - transformLocationToFlexArea(): Location -> FlexAreaFeature
//   - transformLocationsToFlexAreas(): filters and transforms multiple locations
//
// Related PR: https://github.com/interline-io/transitland-lib/pull/527
//////////

/**
 * Agency information embedded in flex area features
 */
export interface FlexAgency {
  agency_id: string
  agency_name: string
  agency_timezone?: string
  agency_url?: string
}

/**
 * Route information embedded in flex area features
 */
export interface FlexRoute {
  route_id: string
  route_long_name?: string
  route_short_name?: string
  route_type: number
  route_url?: string
}

/**
 * Days of week when booking is available
 */
export interface FlexBookingDays {
  monday: boolean
  tuesday: boolean
  wednesday: boolean
  thursday: boolean
  friday: boolean
  saturday: boolean
  sunday: boolean
}

/**
 * Booking rule information from GTFS-Flex booking_rules.txt
 */
export interface FlexBookingRule {
  booking_rule_id: string
  /**
   * booking_type from GTFS-Flex:
   *   0 = Real-time booking (On-Demand)
   *   1 = Same-day booking with advance notice
   *   2 = Prior day(s) booking (More than 24 hours)
   */
  booking_type: number
  info_url?: string
  booking_url?: string
  message?: string
  phone_number?: string
  prior_notice_last_day?: number
  prior_notice_last_time?: number
  prior_notice_last_time_formatted?: string
  /**
   * Days of week when booking is available
   * Derived from prior_notice_service calendar
   */
  booking_days?: FlexBookingDays
}

/**
 * Properties of a flex service area feature
 * Matches the structure in wsdot-all-flex-areas.geojson
 */
export interface FlexAreaProperties {
  // Location identification
  location_id: string
  location_name?: string

  // Agency information
  agencies: FlexAgency[]
  agency_ids: string[]

  // Route information
  routes: FlexRoute[]
  route_ids: string[]
  route_types: number[]

  // Pickup availability and booking rules
  pickup_available: boolean
  pickup_types: number[]
  pickup_booking_rule_ids: string[]
  pickup_booking_rules: FlexBookingRule[]

  // Dropoff availability and booking rules
  drop_off_available: boolean
  drop_off_types: number[]
  drop_off_booking_rule_ids: string[]
  drop_off_booking_rules: FlexBookingRule[]

  // Time windows
  time_window_start?: number
  time_window_start_formatted?: string
  time_window_end?: number
  time_window_end_formatted?: string

  // Trip/schedule information
  trip_ids?: string[]
  trip_count?: number
  stop_time_count?: number

  // Booking availability by day of week (aggregated from all booking rules)
  // If any booking rule allows booking on a day, that day is true
  booking_days?: FlexBookingDays

  // Additional metadata (for CSV export)
  zone_id?: string
  feed_onestop_id?: string

  // Filtering state (set by scenario-filter.ts)
  marked?: boolean
}

/**
 * GeoJSON Feature for a flex service area
 */
export interface FlexAreaFeature {
  type: 'Feature'
  id: string
  geometry: {
    type: 'Polygon' | 'MultiPolygon'
    coordinates: number[][][] | number[][][][]
  }
  properties: FlexAreaProperties
}

/**
 * GeoJSON FeatureCollection of flex service areas
 */
export interface FlexAreaCollection {
  type: 'FeatureCollection'
  features: FlexAreaFeature[]
}

/**
 * Derived area type based on pickup/dropoff availability
 * Maps to the UI filter options
 */
export type FlexAreaType = 'PU only' | 'DO only' | 'PU and DO'

/**
 * Determine the area type based on pickup/dropoff availability
 * Uses the pickup_available and drop_off_available boolean fields
 * @param feature - Flex area feature
 * @returns Area type for filtering
 */
export function getFlexAreaType (feature: FlexAreaFeature): FlexAreaType {
  const hasPickup = feature.properties.pickup_available
  const hasDropoff = feature.properties.drop_off_available

  if (hasPickup && hasDropoff) {
    return 'PU and DO'
  } else if (hasPickup) {
    return 'PU only'
  } else if (hasDropoff) {
    return 'DO only'
  }
  // Default to PU and DO if neither is set (shouldn't happen in valid data)
  return 'PU and DO'
}

/**
 * Advance notice category based on booking_type
 * Maps booking_type values to UI filter options:
 *   0 = On-demand (real-time booking)
 *   1 = Same day (same-day with advance notice)
 *   2 = More than 24 hours (prior day(s) booking)
 */
export type FlexAdvanceNotice = 'On-demand' | 'Same day' | 'More than 24 hours'

/**
 * Map booking_type number to FlexAdvanceNotice string
 */
export function bookingTypeToAdvanceNotice (bookingType: number): FlexAdvanceNotice {
  switch (bookingType) {
    case 0:
      return 'On-demand'
    case 1:
      return 'Same day'
    case 2:
      return 'More than 24 hours'
    default:
      return 'Same day' // Default fallback
  }
}

/**
 * Get the advance notice category for a flex area
 * Uses the booking_type from pickup or dropoff booking rules
 * @param feature - Flex area feature
 * @returns Advance notice category
 */
export function getFlexAdvanceNotice (feature: FlexAreaFeature): FlexAdvanceNotice {
  // Check pickup booking rules first
  const pickupRules = feature.properties.pickup_booking_rules || []
  const firstPickupRule = pickupRules[0]
  if (firstPickupRule && firstPickupRule.booking_type !== undefined) {
    return bookingTypeToAdvanceNotice(firstPickupRule.booking_type)
  }

  // Fall back to dropoff booking rules
  const dropoffRules = feature.properties.drop_off_booking_rules || []
  const firstDropoffRule = dropoffRules[0]
  if (firstDropoffRule && firstDropoffRule.booking_type !== undefined) {
    return bookingTypeToAdvanceNotice(firstDropoffRule.booking_type)
  }

  // Default to Same Day if no booking rules found
  return 'Same day'
}

/**
 * Get the primary agency name for a flex area
 * Uses the first agency in the list
 * @param feature - Flex area feature
 * @returns Agency name or 'Unknown'
 */
export function getFlexAgencyName (feature: FlexAreaFeature): string {
  return feature.properties.agencies?.[0]?.agency_name || 'Unknown Agency'
}

/**
 * Get all unique agency names from a flex area
 * @param feature - Flex area feature
 * @returns Array of agency names
 */
export function getFlexAgencyNames (feature: FlexAreaFeature): string[] {
  return feature.properties.agencies?.map(a => a.agency_name) || []
}

/**
 * Day of week names matching JavaScript Date.getDay() values
 * Sunday = 0, Monday = 1, ..., Saturday = 6
 */
const DAY_KEYS: (keyof FlexBookingDays)[] = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

/**
 * Check if booking is available on a specific day of week
 * @param feature - Flex area feature
 * @param weekday - Day of week (0 = Sunday, 6 = Saturday) - matches Date.getDay()
 * @returns true if booking is available, false otherwise
 * @throws Error if weekday is not in valid range (0-6)
 */
export function isBookingAvailableOnDay (feature: FlexAreaFeature, weekday: number): boolean {
  const bookingDays = feature.properties.booking_days
  // If no booking_days info, assume booking is always available
  if (!bookingDays) { return true }

  // Validate weekday is in valid range
  if (weekday < 0 || weekday > 6) {
    throw new Error(`Invalid weekday: ${weekday}. Must be 0-6 (Sunday=0, Saturday=6)`)
  }

  const dayKey = DAY_KEYS[weekday] as keyof FlexBookingDays
  return bookingDays[dayKey]
}

/**
 * Check if booking is available today
 * @param feature - Flex area feature
 * @returns true if booking is available today
 */
export function isBookingAvailableToday (feature: FlexAreaFeature): boolean {
  return isBookingAvailableOnDay(feature, new Date().getDay())
}

/**
 * Get a human-readable string of booking days
 * @param bookingDays - Booking days object
 * @returns String like "Mon-Fri" or "Mon, Wed, Fri"
 */
export function formatBookingDays (bookingDays: FlexBookingDays | undefined): string {
  if (!bookingDays) { return 'Any day' }

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const available = [
    bookingDays.monday,
    bookingDays.tuesday,
    bookingDays.wednesday,
    bookingDays.thursday,
    bookingDays.friday,
    bookingDays.saturday,
    bookingDays.sunday,
  ]

  // Check for common patterns
  const weekdays = available.slice(0, 5).every(d => d) && !available[5] && !available[6]
  const everyday = available.every(d => d)
  const weekend = !available.slice(0, 5).some(d => d) && available[5] && available[6]

  if (everyday) { return 'Any day' }
  if (weekdays) { return 'Mon-Fri' }
  if (weekend) { return 'Sat-Sun' }

  // Check for consecutive ranges
  const activeDays = days.filter((_, i) => available[i])
  if (activeDays.length === 0) { return 'No days' }

  return activeDays.join(', ')
}

//////////
// GraphQL Query for Flex Locations
//////////

/**
 * Maximum number of stop_times to fetch per location in the GraphQL query.
 * This limit prevents excessive data transfer for locations with many trips.
 * The value of 1000 should cover most flex service areas while keeping
 * response sizes manageable.
 */
export const MAX_STOP_TIMES_PER_LOCATION = 1000

export const flexLocationQuery = gql`
query FlexLocations($fvSha1: String!, $limit: Int, $serviceDate: Date) {
  feed_versions(where: { sha1: $fvSha1 }) {
    id
    sha1
    feed {
      id
      onestop_id
    }
    locations(limit: $limit) {
      id
      location_id
      stop_name
      stop_desc
      zone_id
      geometry
      feed_onestop_id
      # Note: limit must match MAX_STOP_TIMES_PER_LOCATION constant
      stop_times(where: { service_date: $serviceDate }, limit: 1000) {
        pickup_type
        drop_off_type
        start_pickup_drop_off_window
        end_pickup_drop_off_window
        pickup_booking_rule {
          id
          booking_rule_id
          booking_type
          prior_notice_duration_min
          prior_notice_duration_max
          prior_notice_last_day
          prior_notice_last_time
          message
          pickup_message
          drop_off_message
          phone_number
          info_url
          booking_url
          prior_notice_service {
            service_id
            monday
            tuesday
            wednesday
            thursday
            friday
            saturday
            sunday
          }
        }
        drop_off_booking_rule {
          id
          booking_rule_id
          booking_type
          prior_notice_duration_min
          prior_notice_duration_max
          prior_notice_last_day
          prior_notice_last_time
          message
          pickup_message
          drop_off_message
          phone_number
          info_url
          booking_url
          prior_notice_service {
            service_id
            monday
            tuesday
            wednesday
            thursday
            friday
            saturday
            sunday
          }
        }
        trip {
          trip_id
          route {
            route_id
            route_short_name
            route_long_name
            route_type
            route_url
            agency {
              agency_id
              agency_name
              agency_timezone
              agency_url
            }
          }
        }
      }
    }
  }
}
`

//////////
// GraphQL Response Types
//////////

export interface FlexBookingServiceGql {
  service_id: string
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  saturday: number
  sunday: number
}

export interface FlexBookingRuleGql {
  id: number
  booking_rule_id: string
  booking_type: number
  prior_notice_duration_min?: number
  prior_notice_duration_max?: number
  prior_notice_last_day?: number
  prior_notice_last_time?: string // GraphQL Seconds scalar returns HH:MM:SS
  message?: string
  pickup_message?: string
  drop_off_message?: string
  phone_number?: string
  info_url?: string
  booking_url?: string
  prior_notice_service?: FlexBookingServiceGql
}

export interface FlexStopTimeGql {
  pickup_type: number
  drop_off_type: number
  // GraphQL Seconds scalar returns HH:MM:SS string format
  start_pickup_drop_off_window?: string
  end_pickup_drop_off_window?: string
  pickup_booking_rule?: FlexBookingRuleGql
  drop_off_booking_rule?: FlexBookingRuleGql
  trip: {
    trip_id: string
    route: {
      route_id: string
      route_short_name?: string
      route_long_name?: string
      route_type: number
      route_url?: string
      agency: {
        agency_id: string
        agency_name: string
        agency_timezone?: string
        agency_url?: string
      }
    }
  }
}

export interface FlexLocationGql {
  id: number
  location_id: string
  stop_name?: string
  stop_desc?: string
  zone_id?: string
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
  feed_onestop_id: string
  stop_times: FlexStopTimeGql[]
}

export interface FlexLocationQueryResponse {
  feed_versions: {
    id: number
    sha1: string
    feed: {
      id: number
      onestop_id: string
    }
    locations: FlexLocationGql[]
  }[]
}

//////////
// Transformer: Location -> FlexAreaFeature
//////////

/**
 * Transform a GraphQL BookingService to FlexBookingDays
 */
function transformBookingService (service: FlexBookingServiceGql): FlexBookingDays {
  return {
    monday: service.monday === 1,
    tuesday: service.tuesday === 1,
    wednesday: service.wednesday === 1,
    thursday: service.thursday === 1,
    friday: service.friday === 1,
    saturday: service.saturday === 1,
    sunday: service.sunday === 1,
  }
}

/**
 * Transform a GraphQL BookingRule to FlexBookingRule
 */
function transformBookingRule (rule: FlexBookingRuleGql): FlexBookingRule {
  return {
    booking_rule_id: rule.booking_rule_id,
    booking_type: rule.booking_type,
    message: rule.message,
    phone_number: rule.phone_number,
    info_url: rule.info_url,
    booking_url: rule.booking_url,
    prior_notice_last_day: rule.prior_notice_last_day,
    // GraphQL Seconds scalar returns HH:MM:SS string, so use it directly
    prior_notice_last_time: rule.prior_notice_last_time ? parseHMS(rule.prior_notice_last_time) : undefined,
    prior_notice_last_time_formatted: rule.prior_notice_last_time,
    booking_days: rule.prior_notice_service
      ? transformBookingService(rule.prior_notice_service)
      : undefined,
  }
}

/**
 * Merge multiple booking days - if any rule allows booking on a day, that day is available
 */
function mergeBookingDays (days: (FlexBookingDays | undefined)[]): FlexBookingDays | undefined {
  const validDays = days.filter((d): d is FlexBookingDays => d !== undefined)
  if (validDays.length === 0) { return undefined }

  return {
    monday: validDays.some(d => d.monday),
    tuesday: validDays.some(d => d.tuesday),
    wednesday: validDays.some(d => d.wednesday),
    thursday: validDays.some(d => d.thursday),
    friday: validDays.some(d => d.friday),
    saturday: validDays.some(d => d.saturday),
    sunday: validDays.some(d => d.sunday),
  }
}

/**
 * Transform a GraphQL Location into a FlexAreaFeature
 *
 * Aggregates stop_times data into the properties:
 * - Collects unique agencies and routes
 * - Determines pickup/dropoff availability from pickup_type/drop_off_type
 * - Collects booking rules
 * - Aggregates time windows
 */
export function transformLocationToFlexArea (location: FlexLocationGql): FlexAreaFeature {
  const stopTimes = location.stop_times || []

  // Collect unique agencies
  const agencyMap = new Map<string, FlexAgency>()
  for (const st of stopTimes) {
    const agency = st.trip.route.agency
    if (!agencyMap.has(agency.agency_id)) {
      agencyMap.set(agency.agency_id, {
        agency_id: agency.agency_id,
        agency_name: agency.agency_name,
        agency_timezone: agency.agency_timezone,
        agency_url: agency.agency_url,
      })
    }
  }

  // Collect unique routes
  const routeMap = new Map<string, FlexRoute>()
  for (const st of stopTimes) {
    const route = st.trip.route
    if (!routeMap.has(route.route_id)) {
      routeMap.set(route.route_id, {
        route_id: route.route_id,
        route_short_name: route.route_short_name,
        route_long_name: route.route_long_name,
        route_type: route.route_type,
        route_url: route.route_url,
      })
    }
  }

  // Collect pickup/dropoff types and determine availability
  // pickup_type=2 means "Must coordinate with driver to arrange pickup"
  // drop_off_type=2 means "Must coordinate with driver to arrange drop off"
  const pickupTypes = new Set<number>()
  const dropOffTypes = new Set<number>()
  for (const st of stopTimes) {
    pickupTypes.add(st.pickup_type)
    dropOffTypes.add(st.drop_off_type)
  }
  const pickupAvailable = pickupTypes.has(2)
  const dropOffAvailable = dropOffTypes.has(2)

  // Collect unique booking rules
  const pickupBookingRuleMap = new Map<string, FlexBookingRule>()
  const dropOffBookingRuleMap = new Map<string, FlexBookingRule>()
  for (const st of stopTimes) {
    if (st.pickup_booking_rule) {
      const ruleId = st.pickup_booking_rule.booking_rule_id
      if (!pickupBookingRuleMap.has(ruleId)) {
        pickupBookingRuleMap.set(ruleId, transformBookingRule(st.pickup_booking_rule))
      }
    }
    if (st.drop_off_booking_rule) {
      const ruleId = st.drop_off_booking_rule.booking_rule_id
      if (!dropOffBookingRuleMap.has(ruleId)) {
        dropOffBookingRuleMap.set(ruleId, transformBookingRule(st.drop_off_booking_rule))
      }
    }
  }

  // Aggregate time windows (find min start and max end)
  // GraphQL returns Seconds as HH:MM:SS strings, which sort lexicographically correctly
  let timeWindowStartStr: string | undefined
  let timeWindowEndStr: string | undefined
  for (const st of stopTimes) {
    if (st.start_pickup_drop_off_window) {
      if (timeWindowStartStr === undefined || st.start_pickup_drop_off_window < timeWindowStartStr) {
        timeWindowStartStr = st.start_pickup_drop_off_window
      }
    }
    if (st.end_pickup_drop_off_window) {
      if (timeWindowEndStr === undefined || st.end_pickup_drop_off_window > timeWindowEndStr) {
        timeWindowEndStr = st.end_pickup_drop_off_window
      }
    }
  }
  // Convert to seconds for numeric comparisons (e.g., time filtering)
  const timeWindowStart = timeWindowStartStr ? parseHMS(timeWindowStartStr) : undefined
  const timeWindowEnd = timeWindowEndStr ? parseHMS(timeWindowEndStr) : undefined

  // Collect unique trip IDs
  const tripIds = [...new Set(stopTimes.map(st => st.trip.trip_id))]

  // Aggregate booking days from all rules
  const allBookingDays = [
    ...[...pickupBookingRuleMap.values()].map(r => r.booking_days),
    ...[...dropOffBookingRuleMap.values()].map(r => r.booking_days),
  ]
  const mergedBookingDays = mergeBookingDays(allBookingDays)

  // Build properties
  const properties: FlexAreaProperties = {
    // Location identification
    location_id: location.location_id,
    location_name: location.stop_name,

    // Agency information
    agencies: [...agencyMap.values()],
    agency_ids: [...agencyMap.keys()],

    // Route information
    routes: [...routeMap.values()],
    route_ids: [...routeMap.keys()],
    route_types: [...new Set([...routeMap.values()].map(r => r.route_type))],

    // Pickup availability and booking rules
    pickup_available: pickupAvailable,
    pickup_types: [...pickupTypes],
    pickup_booking_rule_ids: [...pickupBookingRuleMap.keys()],
    pickup_booking_rules: [...pickupBookingRuleMap.values()],

    // Dropoff availability and booking rules
    drop_off_available: dropOffAvailable,
    drop_off_types: [...dropOffTypes],
    drop_off_booking_rule_ids: [...dropOffBookingRuleMap.keys()],
    drop_off_booking_rules: [...dropOffBookingRuleMap.values()],

    // Time windows (stored as seconds for filtering, formatted strings for display)
    time_window_start: timeWindowStart,
    time_window_start_formatted: timeWindowStartStr,
    time_window_end: timeWindowEnd,
    time_window_end_formatted: timeWindowEndStr,

    // Trip/schedule information
    trip_ids: tripIds,
    trip_count: tripIds.length,
    stop_time_count: stopTimes.length,

    // Booking availability by day of week
    booking_days: mergedBookingDays,

    // Additional metadata (for CSV export)
    zone_id: location.zone_id,
    feed_onestop_id: location.feed_onestop_id,
  }

  return {
    type: 'Feature',
    id: `${location.feed_onestop_id}:${location.location_id}`,
    geometry: location.geometry as FlexAreaFeature['geometry'],
    properties,
  }
}

/**
 * Transform multiple GraphQL Locations into FlexAreaFeatures
 * Filters out locations with no stop_times (no service on the queried date)
 */
export function transformLocationsToFlexAreas (locations: FlexLocationGql[]): FlexAreaFeature[] {
  return locations
    .filter(loc => loc.stop_times && loc.stop_times.length > 0)
    .map(transformLocationToFlexArea)
}
