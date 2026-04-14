<template>
  <div class="cal-report">
    <cal-title title="Reports">
      Reports
    </cal-title>

    <div class="cal-report-options block">
      <div class="filter-detail">
        <div class="has-text-weight-semibold mb-3">
          Report showing {{ reportTitle }}:
        </div>

        <ul style="list-style: disc inside">
          <li v-for="item of filterSummary" :key="item">
            {{ item }}
          </li>
        </ul>
      </div>

      <div class="cal-report-option-section">
        <!-- Fixed-route service options -->
        <section v-if="props.fixedRouteEnabled" class="mb-2">
          <div class="has-text-weight-semibold mb-1 is-flex is-justify-content-space-between is-align-items-center">
            <span>Showing fixed-route service by:</span>
            <cat-tooltip text="The selected view determines what rows and associated columns appear in the report. Currently only stops can be aggregated by geographies, such as Census geographies.">
              <cat-icon icon="information" />
            </cat-tooltip>
          </div>
          <cat-field class="mb-0">
            <cat-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Transit mode"
              label="Routes"
            />
          </cat-field>
          <cat-field class="mb-0">
            <cat-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Stop visits"
              label="Stops"
            />
          </cat-field>
          <cat-field class="mb-0">
            <cat-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Agency"
              label="Agency"
            />
          </cat-field>
        </section>

        <!-- Flex service options -->
        <section v-if="props.flexDisplayFeatures && props.flexDisplayFeatures.length > 0" class="mb-0">
          <div class="has-text-weight-semibold mb-1 is-flex is-justify-content-space-between is-align-items-center">
            <span>Showing flex service by:</span>
            <cat-tooltip text="The selected view determines what rows and associated columns appear in the report.">
              <cat-icon icon="information" />
            </cat-tooltip>
          </div>
          <cat-field class="mb-0">
            <cat-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Service area"
              label="Service areas"
            />
          </cat-field>
        </section>
      </div>

      <div class="cal-report-option-section">
        <div class="has-text-weight-semibold mb-1 is-flex is-justify-content-space-between is-align-items-center">
          <span>Aggregate by:</span>
          <cat-tooltip text="The selected geography level determines how stop data is grouped in the aggregated table below. Enable 'Show Agg. Areas' in Map Display to visualize these areas on the map.">
            <cat-icon icon="information" />
          </cat-tooltip>
        </div>
        <cat-field class="mb-3">
          <cat-select v-model="aggregateLayer">
            <option
              v-for="option of censusGeographyLayerOptions"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </cat-select>
        </cat-field>

        <div class="has-text-weight-semibold mb-1">
          Download
        </div>
        <cal-geojson-download
          :data="downloadFeatures"
        />
      </div>
    </div>

    <div v-if="geoReportData.columns.length > 0">
      <h4 class="title is-5 mb-4">
        Aggregated by {{ censusLayerLabels[aggregateLayer]?.singular || 'Geographic Area' }}
      </h4>
      <cal-datagrid
        :table-report="geoReportData"
      />
      <hr class="my-5">
    </div>

    <h4 class="title is-5 mb-4">
      Individual results
    </h4>
    <cal-datagrid
      :table-report="reportData"
    >
      <!-- Custom rendering for URLs column -->
      <template #column-urls="{ row }">
        <span class="flex-url-links">
          <span v-if="row.info_url" title="Service Information" class="mr-2">
            <cat-safelink :url="row.info_url">
              <cat-icon icon="information-outline" size="small" />
            </cat-safelink>
          </span>
          <span v-if="row.booking_url" title="Book Online">
            <cat-safelink :url="row.booking_url">
              <cat-icon icon="calendar-check" size="small" />
            </cat-safelink>
          </span>
          <span v-if="!row.info_url && !row.booking_url" class="has-text-grey-light">—</span>
        </span>
      </template>
      <template #column-average_frequency="{ value }">
        {{ formatDuration(value) }}
      </template>
      <template #column-fastest_frequency="{ value }">
        {{ formatDuration(value) }}
      </template>
      <template #column-slowest_frequency="{ value }">
        {{ formatDuration(value) }}
      </template>
      <template #column-earliest_trip_start="{ value }">
        {{ formatClockTime(value) }}
      </template>
      <template #column-earliest_trip_end="{ value }">
        {{ formatClockTime(value) }}
      </template>
      <template #column-latest_trip_start="{ value }">
        {{ formatClockTime(value) }}
      </template>
      <template #column-latest_trip_end="{ value }">
        {{ formatClockTime(value) }}
      </template>
    </cal-datagrid>
  </div>
</template>

<script setup lang="ts">
import type { TableReport, TableColumn } from './datagrid.vue'
import { stopToStopCsv, stopGeoAggregateCsv, routeToRouteCsv, agencyToAgencyCsv } from '~~/src/tl'
import type { ScenarioFilterResult } from '~~/src/scenario'
import { censusLayerLabels, type DataDisplayMode, type Feature } from '~~/src/core'

const props = defineProps<{
  filterSummary: string[]
  censusGeographyLayerOptions: { label: string, value: string }[]
  scenarioFilterResult?: ScenarioFilterResult
  exportFeatures?: Feature[]
  isAllDayMode?: boolean
  // Service type toggles
  fixedRouteEnabled?: boolean
  flexServicesEnabled?: boolean
  flexDisplayFeatures?: Feature[]
}>()

function formatClockTime (value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }
  const h = Math.floor(value / 3600) % 24
  const m = Math.floor((value % 3600) / 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

function formatDuration (value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ''
  }
  const total = Math.round(value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/**
 * Features to export as GeoJSON based on current view mode
 * Uses exportFeatures from parent (map component)
 */
const downloadFeatures = computed((): Feature[] => {
  return props.exportFeatures || []
})

const dataDisplayMode = defineModel<DataDisplayMode>('dataDisplayMode', { default: 'Stop visits' })
const aggregateLayer = defineModel<string>('aggregateLayer', { default: '' })

const routeColumns = computed((): TableColumn[] => {
  const allDay = props.isAllDayMode !== false
  const serviceDays = allDay ? 'across all service days' : 'across all service days and times'
  return [
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
          tooltip: 'The sum of all trips on the indicated route that have any visit at any stop during the days and times included within the current filters, divided by the number of hours across all service days included within the current filters.',
        },
    {
      key: 'average_frequency',
      label: 'Average Frequency',
      sortable: true,
      tooltip: allDay
        ? 'The mean average of all times between trips on the indicated route, calculated as the time in seconds between sequential trip start times, excepting the time between trips on different service days, across all service days included within the current filters.'
        : 'The mean average of all times between trips on the indicated route, calculated as the time in seconds between sequential trip start times, for all trips of the indicated route that have a trip start time within the service days and times included within the current filters.',
    },
    {
      key: 'fastest_frequency',
      label: 'Fastest Frequency',
      sortable: true,
      tooltip: `The shortest time in seconds between two trips of a route, ${serviceDays} included within the current filters.`,
    },
    {
      key: 'slowest_frequency',
      label: 'Slowest Frequency',
      sortable: true,
      tooltip: `The longest time in seconds between two trips of a route, ${serviceDays} included within the current filters, excepting the time in between trips on different service days.`,
    },
    {
      key: 'earliest_trip_start',
      label: 'Earliest Trip Start',
      sortable: true,
      tooltip: `The 24-hour time at which the first visit at a stop that begins a trip happens for this route, ${serviceDays} included within the current filters.`,
    },
    {
      key: 'earliest_trip_end',
      label: 'Earliest Trip End',
      sortable: true,
      tooltip: `The 24-hour time at which the first visit at a stop that ends a trip happens for this route, ${serviceDays} included within the current filters.`,
    },
    {
      key: 'latest_trip_start',
      label: 'Latest Trip Start',
      sortable: true,
      tooltip: `The 24-hour time at which the last visit at a stop that begins a trip happens for this route, ${serviceDays} included within the current filters.`,
    },
    {
      key: 'latest_trip_end',
      label: 'Latest Trip End',
      sortable: true,
      tooltip: `The 24-hour time at which the last visit at a stop that ends a trip happens for this route, ${serviceDays} included within the current filters.`,
    },
  ]
})

const stopColumns = computed((): TableColumn[] => {
  const allDay = props.isAllDayMode !== false
  const duringDays = allDay ? 'during days' : 'during days and times'
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  return [
    { key: 'stop_id', label: 'Stop ID', sortable: true },
    { key: 'stop_name', label: 'Stop Name', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    {
      key: 'routes_count',
      label: 'Routes Served',
      sortable: true,
      tooltip: `The number of routes that visit this stop ${duringDays} included within the current filters.`,
    },
    {
      key: 'agencies_count',
      label: 'Agencies Served',
      sortable: true,
      tooltip: `The number of agencies that visit this stop ${duringDays} included within the current filters.`,
    },
    {
      key: 'visit_count_total',
      label: 'Total Visits During Time Period',
      sortable: true,
      tooltip: `The sum of all visits at the stop by any route ${acrossDays} included within the current filters.`,
    },
  ]
})

const stopGeoAggregateColumns = computed((): TableColumn[] => {
  const allDay = props.isAllDayMode !== false
  const duringDays = allDay ? 'during days' : 'during days and times'
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  return [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'stops_count', label: 'Number of Stops', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    {
      key: 'routes_count',
      label: 'Routes Served',
      sortable: true,
      tooltip: `The number of routes that visit stops within this area ${duringDays} included within the current filters.`,
    },
    {
      key: 'agencies_count',
      label: 'Agencies Served',
      sortable: true,
      tooltip: `The number of agencies that visit stops within this area ${duringDays} included within the current filters.`,
    },
    {
      key: 'visit_count_total',
      label: 'Total Visits During Time Period',
      sortable: true,
      tooltip: `The sum of all visits at stops within this area by any route ${acrossDays} included within the current filters.`,
    },
  ]
})
const agencyColumns: TableColumn[] = [
  { key: 'agency_id', label: 'Agency ID', sortable: true },
  { key: 'agency_name', label: 'Agency Name', sortable: true },
  { key: 'routes_count', label: 'Number of Routes', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'stops_count', label: 'Number of Stops', sortable: true },
]

const flexAreaColumns: TableColumn[] = [
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

/**
 * Convert flex feature to CSV row data
 */
function flexFeatureToCsv (feature: Feature): Record<string, string | number | undefined> {
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

// const agencyColumnsAggregate: TableColumn[] = [
//   { key: 'aggregate_name', label: 'Name', sortable: true },
//   { key: 'aggregate_total', label: 'Number of Agencies', sortable: true },
//   { key: 'number_routes', label: 'Number of Routes', sortable: true },
//   { key: 'number_stops', label: 'Number of Stops', sortable: true },
// ]

const geoReportData = computed((): TableReport => {
  if (aggregateLayer.value === '' || aggregateLayer.value === 'none') {
    return { data: [], columns: [] }
  }
  // Handle aggregation
  if (dataDisplayMode.value === 'Stop visits') {
    return {
      data: stopGeoAggregateCsv((props.scenarioFilterResult?.stops || []).filter(s => (s.marked)), aggregateLayer.value),
      columns: stopGeoAggregateColumns.value
    }
  }
  return { data: [], columns: [] }
})

const reportData = computed((): TableReport => {
  if (dataDisplayMode.value === 'Transit mode' || dataDisplayMode.value === 'Route frequency') {
    return {
      data: (props.scenarioFilterResult?.routes || []).filter(s => (s.marked)).map(routeToRouteCsv),
      columns: routeColumns.value
    }
  } else if (dataDisplayMode.value === 'Stop visits') {
    return {
      data: (props.scenarioFilterResult?.stops || []).filter(s => s.marked).map(stopToStopCsv),
      columns: stopColumns.value
    }
  } else if (dataDisplayMode.value === 'Agency') {
    return {
      data: (props.scenarioFilterResult?.agencies || []).filter(s => s.marked).map(agencyToAgencyCsv),
      columns: agencyColumns
    }
  } else if (dataDisplayMode.value === 'Service area') {
    return {
      data: (props.flexDisplayFeatures || []).map(flexFeatureToCsv),
      columns: flexAreaColumns
    }
  }
  return { data: [], columns: [] }
})

const reportTitle = computed(() => {
  if (dataDisplayMode.value === 'Transit mode' || dataDisplayMode.value === 'Route frequency') {
    return 'routes'
  } else if (dataDisplayMode.value === 'Stop visits') {
    return 'stops'
  } else if (dataDisplayMode.value === 'Agency') {
    return 'agencies'
  } else if (dataDisplayMode.value === 'Service area') {
    return 'flex service areas'
  }
  return ''
})
</script>

<style scoped lang="scss">
  .cal-report {
    display:flex;
    flex-direction:column;
    background: var(--bulma-scheme-main);
    height:100%;
    width: calc(100vw - 100px);
    padding-left:20px;
    padding-right:20px;
    > .cal-body {
      > div, > article {
        margin-bottom:10px;
      }
    }
  }

  .cal-report-options {
    display: flex;
    flex: 0;
    flex-flow: row nowrap;
    justify-content: space-between;

    > .filter-detail {
      flex: 1 1 25%;
      align-self: stretch;
      background-color: #f8f9fa;
      border: 1px solid #333;
      padding: 1rem;
      border-radius: 6px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    > .cal-report-option-section {
      flex: 1;
      align-self: stretch;
      border: 1px solid #333;
      padding: 1rem;
      margin-left: 15px;
      background-color: #fff;
      border-radius: 6px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);

      > .which-report {
        font-size: larger;
        font-weight: bold;
      }
    }

    > .cal-report-download {
      flex: 1;
      display: flex;
      align-self: center;
      flex-flow: column nowrap;
      margin-left: 15px;
    }
  }
</style>
