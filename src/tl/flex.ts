import { gql } from 'graphql-tag'
import type {
  FlexAreaFeature,
  FlexAreaProperties,
  FlexAgency,
  FlexRoute,
  FlexBookingRule,
  FlexBookingDays
} from '~~/src/flex'

//////////
// GraphQL Query for Flex Locations
//////////

export const flexLocationQuery = gql`
query FlexLocations($fvSha1: String!, $limit: Int, $date: Date) {
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
      stop_times(where: { date: $date }, limit: 1000) {
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
 * Parse HH:MM:SS string to seconds
 */
function parseHMS (hms: string): number {
  const parts = hms.split(':')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return 0
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const s = parseInt(parts[2], 10)
  if (isNaN(h) || isNaN(m) || isNaN(s)) return 0
  return h * 3600 + m * 60 + s
}

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
  if (validDays.length === 0) return undefined

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
