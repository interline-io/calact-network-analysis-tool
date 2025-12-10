<template>
  <div class="cal-report">
    <tl-title title="Reports">
      Reports
    </tl-title>

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
            <o-tooltip multiline label="The selected view determines what rows and associated columns appear in the report. Currently only stops can be aggregated by geographies, such as Census geographies.">
              <o-icon icon="information" />
            </o-tooltip>
          </div>
          <o-field class="mb-0">
            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Route"
              label="Route"
            />
          </o-field>
          <o-field class="mb-0">
            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Stop"
              label="Stop"
            />
          </o-field>
          <o-field class="mb-0">
            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="Agency"
              label="Agency"
            />
          </o-field>
        </section>

        <!-- Flex service options -->
        <section v-if="props.hasFlexData" class="mb-0">
          <div class="has-text-weight-semibold mb-1 is-flex is-justify-content-space-between is-align-items-center">
            <span>Showing flex service by:</span>
            <o-tooltip multiline label="The selected view determines what rows and associated columns appear in the report.">
              <o-icon icon="information" />
            </o-tooltip>
          </div>
          <o-field class="mb-0">
            <o-radio
              v-model="dataDisplayMode"
              name="dataDisplayMode"
              native-value="area"
              label="Area"
            />
          </o-field>
        </section>
      </div>

      <div class="cal-report-download">
        <cal-geojson-download
          :data="downloadFeatures"
        />
      </div>
    </div>

    <div v-if="geoReportData.columns.length > 0">
      <h4 class="title is-5 mb-4">
        <o-tooltip multiline label="To change geographic aggregation: Go to the Query tab and expand Advanced Settings to select a different Census geography hierarchy level.">
          Aggregated by {{ getGeographyLabel(aggregateLayer) }}
          <o-icon icon="information" />
        </o-tooltip>
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
            <tl-safelink :url="row.info_url">
              <o-icon icon="information-outline" size="small" />
            </tl-safelink>
          </span>
          <span v-if="row.booking_url" title="Book Online">
            <tl-safelink :url="row.booking_url">
              <o-icon icon="calendar-check" size="small" />
            </tl-safelink>
          </span>
          <span v-if="!row.info_url && !row.booking_url" class="has-text-grey-light">—</span>
        </span>
      </template>
    </cal-datagrid>
  </div>
</template>

<script setup lang="ts">
import type { TableReport, TableColumn } from './datagrid.vue'
import { stopToStopCsv, stopGeoAggregateCsv, routeToRouteCsv, agencyToAgencyCsv } from '~~/src/tl'
import type { ScenarioFilterResult } from '~~/src/scenario'
import type { Feature } from '~~/src/core'

const props = defineProps<{
  filterSummary: string[]
  censusGeographyLayerOptions: { label: string, value: string }[]
  scenarioFilterResult?: ScenarioFilterResult
  exportFeatures?: Feature[]
  // Service type toggles
  fixedRouteEnabled?: boolean
  flexServicesEnabled?: boolean
  hasFlexData?: boolean
  flexDisplayFeatures?: Feature[]
}>()

/**
 * Features to export as GeoJSON based on current view mode
 * - Fixed-route modes use exportFeatures from parent (map component)
 * - Area mode (dataDisplayMode='area') uses flexDisplayFeatures
 */
const downloadFeatures = computed((): Feature[] => {
  if (dataDisplayMode.value === 'area') {
    return props.flexDisplayFeatures || []
  }
  return props.exportFeatures || []
})

const dataDisplayMode = defineModel<string>('dataDisplayMode', { default: 'Stop' })
const aggregateLayer = defineModel<string>('aggregateLayer', { default: '' })

// TODO: For when we switch to datagrid
const routeColumns: TableColumn[] = [
  { key: 'route_id', label: 'Route ID', sortable: true },
  { key: 'route_name', label: 'Route Name', sortable: true },
  { key: 'route_mode', label: 'Mode', sortable: true },
  { key: 'agency_name', label: 'Agency', sortable: true },
  { key: 'average_frequency', label: 'Average Frequency', sortable: true },
  { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
  { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
]

// const routeColumnsAggregate: TableColumn[] = [
//   { key: 'aggregate_name', label: 'Name', sortable: true },
//   { key: 'aggregate_total', label: 'Number of Routes', sortable: true },
//   { key: 'average_frequency', label: 'Average Frequency', sortable: true },
//   { key: 'fastest_frequency', label: 'Fastest Frequency', sortable: true },
//   { key: 'slowest_frequency', label: 'Slowest Frequency', sortable: true },
// ]

const stopColumns: TableColumn[] = [
  { key: 'stop_id', label: 'Stop ID', sortable: true },
  { key: 'stop_name', label: 'Stop Name', sortable: true },
  { key: 'routes_modes', label: 'Modes', sortable: true },
  { key: 'routes_count', label: 'Routes Served', sortable: true },
  { key: 'agencies_count', label: 'Agencies Served', sortable: true },
  { key: 'visit_count_daily_average', label: 'Average Visits', sortable: true },
]

const getGeographyLabel = (layer: string) => {
  const layerMap: Record<string, string> = {
    'state': 'State',
    'county': 'County',
    'tract': 'Census Tract',
    'place': 'City/Place',
    'cbsa': 'Metropolitan Area',
    'csa': 'Combined Statistical Area',
    'uac20': 'Urban Area',
    'fta-uac20-nonurban': 'Non-urban Area',
    'fta-uac20-urban.geojsonl': 'Urban Area'
  }
  return layerMap[layer] || 'Geographic Area'
}

const stopGeoAggregateColumns = computed((): TableColumn[] => {
  return [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'stops_count', label: 'Number of Stops', sortable: true },
    { key: 'routes_modes', label: 'Modes', sortable: true },
    { key: 'routes_count', label: 'Routes Served', sortable: true },
    { key: 'agencies_count', label: 'Agencies Served', sortable: true },
    { key: 'visit_count_daily_average', label: 'Average Visits', sortable: true },
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
  if (dataDisplayMode.value === 'Stop') {
    return {
      data: stopGeoAggregateCsv((props.scenarioFilterResult?.stops || []).filter(s => (s.marked)), aggregateLayer.value),
      columns: stopGeoAggregateColumns.value
    }
  }
  return { data: [], columns: [] }
})

const reportData = computed((): TableReport => {
  // Non-aggregated data
  if (dataDisplayMode.value === 'Route') {
    return {
      data: (props.scenarioFilterResult?.routes || []).filter(s => (s.marked)).map(routeToRouteCsv),
      columns: routeColumns
    }
  } else if (dataDisplayMode.value === 'Stop') {
    return {
      data: (props.scenarioFilterResult?.stops || []).filter(s => s.marked).map(stopToStopCsv),
      columns: stopColumns
    }
  } else if (dataDisplayMode.value === 'Agency') {
    return {
      data: (props.scenarioFilterResult?.agencies || []).filter(s => s.marked).map(agencyToAgencyCsv),
      columns: agencyColumns
    }
  } else if (dataDisplayMode.value === 'area') {
    return {
      data: (props.flexDisplayFeatures || []).map(flexFeatureToCsv),
      columns: flexAreaColumns
    }
  }
  return { data: [], columns: [] }
})

const reportTitle = computed(() => {
  if (dataDisplayMode.value === 'Route') {
    return 'routes'
  } else if (dataDisplayMode.value === 'Stop') {
    return 'stops'
  } else if (dataDisplayMode.value === 'Agency') {
    return 'agencies'
  } else if (dataDisplayMode.value === 'area') {
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
