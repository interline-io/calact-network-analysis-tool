import { CENSUS_COLUMNS, type Feature, type TableColumn } from '~~/src/core'

// Column definitions and row transforms for the report tables. Kept out of the
// report.vue SFC so they're pure and unit-testable; the component supplies the
// reactive flags (all-day mode, buffer radius, buffer aggregation) as arguments.

// Census demographic columns appended to the route/stop/agency/aggregate tables
// when a stop statistical radius is in effect.
function buildCensusColumns (apportioned: boolean): TableColumn[] {
  const tooltip = apportioned
    ? 'Apportioned to the area within the stop statistical radius. Median values are not apportioned and render as "—".'
    : undefined
  return CENSUS_COLUMNS.map(c => ({
    key: c.id,
    label: c.label,
    sortable: true,
    format: c.format,
    tooltip,
  }))
}

export function buildRouteColumns (allDay: boolean, includeCensus: boolean): TableColumn[] {
  const timeScope = allDay ? 'across all service days' : 'across all service days and times'
  const cols: TableColumn[] = [
    { key: 'route_id', label: 'Route ID', sortable: true },
    { key: 'route_name', label: 'Route Name', sortable: true },
    { key: 'route_mode', label: 'Mode', sortable: true },
    { key: 'agency_name', label: 'Agency', sortable: true },
    allDay
      ? {
          key: 'average_trips_per_day',
          label: 'Average Trips per Day',
          sortable: true,
          tooltip: 'The sum of all trips on the indicated route, divided by the number of calendar days included within the current filters.',
        }
      : {
          key: 'average_trips_per_hour',
          label: 'Average Trips per Hour',
          sortable: true,
          tooltip: 'The sum of all trips on the indicated route that have any visit at any stop during the days and times included within the current filters, divided by the number of hours across all calendar days included within the current filters.',
        },
    {
      key: 'average_frequency',
      label: 'Average Frequency',
      sortable: true,
      tooltip: allDay
        ? 'Mean duration between consecutive trips on the indicated route, excepting gaps between trips on different service days, across all service days included within the current filters. Click a cell to see the detailed calculation.'
        : 'Mean duration between consecutive trips on the indicated route within the days and times included within the current filters. Click a cell to see the detailed calculation.',
    },
    {
      key: 'fastest_frequency',
      label: 'Fastest Frequency',
      sortable: true,
      tooltip: `Shortest duration between two consecutive trips on the indicated route, ${allDay ? 'across all service days' : 'across the days and times'} included within the current filters.`,
    },
    {
      key: 'slowest_frequency',
      label: 'Slowest Frequency',
      sortable: true,
      tooltip: `Longest duration between two consecutive trips on the indicated route, ${allDay ? 'across all service days' : 'across the days and times'} included within the current filters, excepting gaps between trips on different service days.`,
    },
    {
      key: 'earliest_trip_start',
      label: 'Earliest Trip Start',
      sortable: true,
      tooltip: `The time at which the earliest trip on this route begins, ${timeScope} included within the current filters.`,
    },
    {
      key: 'earliest_trip_end',
      label: 'Earliest Trip End',
      sortable: true,
      tooltip: `The time at which the earliest trip on this route ends, ${timeScope} included within the current filters.`,
    },
    {
      key: 'latest_trip_start',
      label: 'Latest Trip Start',
      sortable: true,
      tooltip: `The time at which the latest trip on this route begins, ${timeScope} included within the current filters.`,
    },
    {
      key: 'latest_trip_end',
      label: 'Latest Trip End',
      sortable: true,
      tooltip: `The time at which the latest trip on this route ends, ${timeScope} included within the current filters.`,
    },
  ]
  if (includeCensus) {
    cols.push(...buildCensusColumns(true))
  }
  return cols
}

export function buildStopColumns (allDay: boolean, includeCensus: boolean): TableColumn[] {
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  const cols: TableColumn[] = [
    { key: 'stop_id', label: 'Stop ID', sortable: true },
    { key: 'stop_name', label: 'Stop Name', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    {
      key: 'routes_count',
      label: 'Routes Served',
      sortable: true,
      tooltip: 'The total number of routes that serve this stop. Not currently filtered by the route, agency, or timeframe filters.',
    },
    {
      key: 'agencies_count',
      label: 'Agencies Served',
      sortable: true,
      tooltip: 'The total number of agencies whose routes serve this stop. Not currently filtered by the route, agency, or timeframe filters.',
    },
    {
      key: 'visit_count_total',
      label: 'Total Visits During Time Period',
      sortable: true,
      tooltip: `The sum of all visits at the stop by any route ${acrossDays} included within the current filters. Not currently filtered by the route or agency filters.`,
    },
  ]
  if (includeCensus) {
    cols.push(...buildCensusColumns(true))
  }
  return cols
}

export function buildStopGeoAggregateColumns (allDay: boolean, bufferAggregationActive: boolean): TableColumn[] {
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  const cols: TableColumn[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'stops_count', label: 'Number of Stops', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    {
      key: 'routes_count',
      label: 'Routes Served',
      sortable: true,
      tooltip: 'The total number of routes that serve stops within this area. Not currently filtered by the route, agency, or timeframe filters.',
    },
    {
      key: 'agencies_count',
      label: 'Agencies Served',
      sortable: true,
      tooltip: 'The total number of agencies whose routes serve stops within this area. Not currently filtered by the route, agency, or timeframe filters.',
    },
    {
      key: 'visit_count_total',
      label: 'Total Visits During Time Period',
      sortable: true,
      tooltip: `The sum of all visits at stops within this area by any route ${acrossDays} included within the current filters. Not currently filtered by the route or agency filters.`,
    },
    ...buildCensusColumns(bufferAggregationActive),
  ]
  if (bufferAggregationActive) {
    cols.push({
      key: 'pct_buffer_coverage',
      label: '% Area within Stop Radius',
      sortable: true,
      format: 'percent',
      tooltip: 'Percentage of this area covered by the union of stop statistical radii. Demographic columns are apportioned to that covered portion.',
    })
  }
  return cols
}

// one row per cross-agency transfer-hub cluster.
export const stopClusterColumns: TableColumn[] = [
  { key: 'cluster', label: 'Cluster', sortable: true },
  {
    key: 'agencies_count',
    label: 'Agencies',
    sortable: true,
    tooltip: 'Number of distinct agencies meeting at this cluster.',
  },
  { key: 'agencies', label: 'Agency Names', sortable: true },
  {
    key: 'stops_count',
    label: 'Stops',
    sortable: true,
    tooltip: 'Number of member stops in the cluster.',
  },
  { key: 'routes_count', label: 'Routes', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'member_stops', label: 'Member Stops', sortable: false },
]

export function buildAgencyColumns (includeCensus: boolean): TableColumn[] {
  const cols: TableColumn[] = [
    { key: 'agency_id', label: 'Agency ID', sortable: true },
    { key: 'agency_name', label: 'Agency Name', sortable: true },
    { key: 'routes_count', label: 'Number of Routes', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    { key: 'stops_count', label: 'Number of Stops', sortable: true },
  ]
  if (includeCensus) {
    cols.push(...buildCensusColumns(true))
  }
  return cols
}

export const flexAreaColumns: TableColumn[] = [
  { key: 'location_name', label: 'Location Name', sortable: true },
  { key: 'agency_names', label: 'Agency Name(s)', sortable: true },
  { key: 'route_names', label: 'Route Name(s)', sortable: true },
  { key: 'area_type', label: 'Service Type', sortable: true },
  { key: 'time_window', label: 'Operating Hours', sortable: true },
  { key: 'advance_notice', label: 'Advance Notice', sortable: true },
  { key: 'phone_number', label: 'Phone', sortable: true },
  { key: 'urls', label: 'Links', sortable: false },
  { key: 'trip_count', label: 'Trips', sortable: true },
]

// Convert a flex feature to CSV row data (also drives the flex table display).
export function flexFeatureToCsv (feature: Feature): Record<string, string | number | undefined> {
  const props = feature.properties || {}

  // Format time window if available
  let timeWindow = ''
  if (props.time_window_start_formatted && props.time_window_end_formatted) {
    timeWindow = `${props.time_window_start_formatted} - ${props.time_window_end_formatted}`
  }

  const infoUrl = props.info_url || ''
  const bookingUrl = props.booking_url || ''

  return {
    location_id: props.location_id,
    // Use location_name if available, otherwise show location_id as fallback
    location_name: props.location_name || props.location_id || '',
    agency_names: props.agency_names || props.agency_name || '',
    route_names: props.route_names || '',
    area_type: props.area_type || '',
    time_window: timeWindow,
    advance_notice: props.advance_notice || '',
    phone_number: props.phone_number || '',
    // For table display, we use a combined 'urls' field; for CSV, we use separate columns
    urls: [infoUrl, bookingUrl].filter(Boolean).join(' | ') || '',
    info_url: infoUrl,
    booking_url: bookingUrl,
    trip_count: props.trip_count || 0,
    // Additional metadata for CSV export (not shown in UI table)
    zone_id: props.zone_id || '',
    feed_onestop_id: props.feed_onestop_id || '',
    prior_notice_last_day: props.prior_notice_last_day ?? '',
    prior_notice_last_time: props.prior_notice_last_time || '',
    booking_instructions: props.booking_instructions || '',
  }
}
