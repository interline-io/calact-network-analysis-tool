/**
 * Flex Services (DRT/Demand-Responsive Transit) TypeScript types
 * Based on GTFS-Flex extension data structure
 *
 * GraphQL Schema Mapping (transitland-server):
 * ============================================
 *
 * Location (GraphQL) -> FlexAreaFeature (this file)
 *   - location.id -> feature.id
 *   - location.location_id -> properties.location_id
 *   - location.stop_name -> properties.location_name
 *   - location.geometry -> feature.geometry
 *   - location.feed_onestop_id -> (used for feed association)
 *
 * FlexStopTime (GraphQL) -> Aggregated into FlexAreaProperties
 *   - stop_time.pickup_type -> properties.pickup_types[], pickup_available
 *   - stop_time.drop_off_type -> properties.drop_off_types[], drop_off_available
 *   - stop_time.start_pickup_drop_off_window -> properties.time_window_start
 *   - stop_time.end_pickup_drop_off_window -> properties.time_window_end
 *   - stop_time.pickup_booking_rule -> properties.pickup_booking_rules[]
 *   - stop_time.drop_off_booking_rule -> properties.drop_off_booking_rules[]
 *   - stop_time.trip.route.agency -> properties.agencies[]
 *
 * BookingRule (GraphQL) -> FlexBookingRule (this file)
 *   - booking_rule.booking_type -> booking_type (0=realtime, 1=same-day, 2=prior-day)
 *   - booking_rule.phone_number -> phone_number
 *   - booking_rule.info_url -> info_url
 *   - booking_rule.message -> message
 *
 * The transformation is implemented in src/tl/flex.ts:
 *   - transformLocationToFlexArea(): Location -> FlexAreaFeature
 *   - transformLocationsToFlexAreas(): filters and transforms multiple locations
 *
 * Related PR: https://github.com/interline-io/transitland-lib/pull/527
 */

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
 * Values are 0 (not available) or 1 (available)
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
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'
]

/**
 * Check if booking is available on a specific day of week
 * @param feature - Flex area feature
 * @param dayOfWeek - Day of week (0 = Sunday, 6 = Saturday) - matches Date.getDay()
 * @returns true if booking is available, false otherwise
 */
export function isBookingAvailableOnDay (feature: FlexAreaFeature, dayOfWeek: number): boolean {
  const bookingDays = feature.properties.booking_days
  // If no booking_days info, assume booking is always available
  if (!bookingDays) return true

  // Ensure dayOfWeek is valid (0-6)
  if (dayOfWeek < 0 || dayOfWeek > 6) return true

  const dayKey = DAY_KEYS[dayOfWeek] as keyof FlexBookingDays
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
  if (!bookingDays) return 'Any day'

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const available = [
    bookingDays.monday,
    bookingDays.tuesday,
    bookingDays.wednesday,
    bookingDays.thursday,
    bookingDays.friday,
    bookingDays.saturday,
    bookingDays.sunday
  ]

  // Check for common patterns
  const weekdays = available.slice(0, 5).every(d => d) && !available[5] && !available[6]
  const everyday = available.every(d => d)
  const weekend = !available.slice(0, 5).some(d => d) && available[5] && available[6]

  if (everyday) return 'Any day'
  if (weekdays) return 'Mon-Fri'
  if (weekend) return 'Sat-Sun'

  // Check for consecutive ranges
  const activeDays = days.filter((_, i) => available[i])
  if (activeDays.length === 0) return 'No days'

  return activeDays.join(', ')
}
