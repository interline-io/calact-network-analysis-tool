import {
  getFlexAreaType,
  getFlexAdvanceNotice,
  getFlexAgencyName,
  type FlexAreaFeature,
} from '~~/src/tl'

/**
 * Properties object for a flex area feature ready for display in map or report
 */
export interface FlexAreaDisplayProperties {
  location_id: string
  location_name?: string
  agency_name: string
  agency_names: string
  route_names: string
  area_type: string
  time_window_start_formatted?: string
  time_window_end_formatted?: string
  advance_notice: string
  phone_number?: string
  booking_message?: string
  info_url?: string
  booking_url?: string
  trip_count?: number
  // Additional fields for CSV export
  zone_id?: string
  feed_onestop_id?: string
  prior_notice_last_day?: number
  prior_notice_last_time?: string
  booking_instructions?: string
  marked: boolean
}

/**
 * Composable for formatting flex area features for display
 * Extracts common logic used by both map and report components
 */
export function useFlexAreaFormatting () {
  /**
   * Build display properties for a flex area feature
   * @param feature - The flex area feature from scenario data
   * @param marked - Whether the feature matches current filters
   * @returns Properties object ready for display
   */
  function buildFlexAreaProperties (feature: FlexAreaFeature, marked: boolean): FlexAreaDisplayProperties {
    const bookingRule = feature.properties.pickup_booking_rules?.[0]
      || feature.properties.drop_off_booking_rules?.[0]

    return {
      location_id: feature.properties.location_id,
      location_name: feature.properties.location_name,
      agency_name: getFlexAgencyName(feature),
      agency_names: feature.properties.agencies?.map((a: { agency_name: string }) => a.agency_name).join(', ') || '',
      route_names: feature.properties.routes?.map((r: { route_long_name?: string, route_short_name?: string, route_id: string }) =>
        r.route_long_name || r.route_short_name || r.route_id
      ).join(', ') || '',
      area_type: getFlexAreaType(feature),
      time_window_start_formatted: feature.properties.time_window_start_formatted,
      time_window_end_formatted: feature.properties.time_window_end_formatted,
      advance_notice: getFlexAdvanceNotice(feature),
      phone_number: bookingRule?.phone_number,
      booking_message: bookingRule?.message,
      info_url: bookingRule?.info_url,
      booking_url: feature.properties.pickup_booking_rules?.[0]?.booking_url
        || feature.properties.drop_off_booking_rules?.[0]?.booking_url,
      trip_count: feature.properties.trip_count,
      // Additional fields for CSV export (not shown in UI table)
      zone_id: feature.properties.zone_id,
      feed_onestop_id: feature.properties.feed_onestop_id,
      prior_notice_last_day: bookingRule?.prior_notice_last_day,
      prior_notice_last_time: bookingRule?.prior_notice_last_time_formatted,
      booking_instructions: bookingRule?.message,
      marked: marked,
    }
  }

  /**
   * Get route display name with fallback to route_id
   * @param route - Route object with optional name fields
   * @returns Best available name for the route
   */
  function getRouteDisplayName (route: { route_long_name?: string, route_short_name?: string, route_id: string }): string {
    return route.route_long_name || route.route_short_name || route.route_id
  }

  return {
    buildFlexAreaProperties,
    getRouteDisplayName,
  }
}
