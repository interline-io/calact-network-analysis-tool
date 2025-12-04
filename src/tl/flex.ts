import { gql } from 'graphql-tag'
import type {
  FlexAreaFeature,
  FlexAreaProperties,
  FlexAgency,
  FlexRoute,
  FlexBookingRule
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

export interface FlexBookingRuleGql {
  id: number
  booking_rule_id: string
  booking_type: number
  prior_notice_duration_min?: number
  prior_notice_duration_max?: number
  prior_notice_last_day?: number
  prior_notice_last_time?: number // seconds
  message?: string
  pickup_message?: string
  drop_off_message?: string
  phone_number?: string
  info_url?: string
  booking_url?: string
}

export interface FlexStopTimeGql {
  pickup_type: number
  drop_off_type: number
  start_pickup_drop_off_window?: number // seconds
  end_pickup_drop_off_window?: number // seconds
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
 * Format seconds as HH:MM:SS
 */
function formatSeconds (seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':')
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
    prior_notice_last_day: rule.prior_notice_last_day,
    prior_notice_last_time: rule.prior_notice_last_time,
    prior_notice_last_time_formatted: rule.prior_notice_last_time
      ? formatSeconds(rule.prior_notice_last_time)
      : undefined,
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
  let timeWindowStart: number | undefined
  let timeWindowEnd: number | undefined
  for (const st of stopTimes) {
    if (st.start_pickup_drop_off_window !== undefined) {
      if (timeWindowStart === undefined || st.start_pickup_drop_off_window < timeWindowStart) {
        timeWindowStart = st.start_pickup_drop_off_window
      }
    }
    if (st.end_pickup_drop_off_window !== undefined) {
      if (timeWindowEnd === undefined || st.end_pickup_drop_off_window > timeWindowEnd) {
        timeWindowEnd = st.end_pickup_drop_off_window
      }
    }
  }

  // Collect unique trip IDs
  const tripIds = [...new Set(stopTimes.map(st => st.trip.trip_id))]

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

    // Time windows
    time_window_start: timeWindowStart,
    time_window_start_formatted: timeWindowStart !== undefined
      ? formatSeconds(timeWindowStart)
      : undefined,
    time_window_end: timeWindowEnd,
    time_window_end_formatted: timeWindowEnd !== undefined
      ? formatSeconds(timeWindowEnd)
      : undefined,

    // Trip/schedule information
    trip_ids: tripIds,
    trip_count: tripIds.length,
    stop_time_count: stopTimes.length,
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
