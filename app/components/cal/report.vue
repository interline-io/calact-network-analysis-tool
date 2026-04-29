<template>
  <div class="cal-report">
    <div class="cal-report-title-row">
      <cal-title :title="reportHeading">
        {{ reportHeading }}
      </cal-title>
      <cal-geojson-download
        :data="downloadFeatures"
        variant="primary"
      />
    </div>

    <div class="cal-report-header block">
      <div class="cal-report-filter-tags mb-4">
        <span
          v-for="tag of filterTags"
          :key="tag.label + tag.value"
          class="tag is-medium"
          :class="tag.active ? 'is-primary' : 'is-light'"
        >
          {{ tag.label }}: {{ tag.value }}
        </span>
      </div>

      <cat-tabs v-model="activeReportTab" type="boxed">
        <cat-tab-item v-if="fixedRouteEnabled" value="routes" label="Routes" />
        <cat-tab-item v-if="fixedRouteEnabled" value="stops" label="Stops (Individual)" />
        <cat-tab-item v-if="fixedRouteEnabled && hasAggregateLayer" value="stops-aggregated" label="Stops (Aggregated)" />
        <cat-tab-item v-if="fixedRouteEnabled" value="agencies" label="Agencies" />
        <cat-tab-item v-if="props.flexDisplayFeatures && props.flexDisplayFeatures.length > 0" value="flex" label="Flex Areas" />
      </cat-tabs>
    </div>

    <!-- Aggregation layer selector for aggregated tab -->
    <div v-if="activeReportTab === 'stops-aggregated'" class="mb-4 is-flex is-align-items-center" style="gap: 0.5rem">
      <span class="has-text-weight-semibold">Aggregate by:</span>
      <cat-select v-model="aggregateLayer" style="width: auto">
        <option
          v-for="option of censusGeographyLayerOptions"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </cat-select>
      <cat-tooltip text="The selected geography level determines how stop data is grouped. Enable 'Show Agg. Areas' in Map Display to visualize these areas on the map.">
        <cat-icon icon="information" />
      </cat-tooltip>
    </div>

    <cal-datagrid
      :table-report="activeTableReport"
    >
      <!-- Custom rendering for URLs column (flex areas) -->
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
      <template #column-average_trips_per_day="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ value }}
        </button>
      </template>
      <template #column-average_trips_per_hour="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ value }}
        </button>
      </template>
      <template #column-average_frequency="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'frequency')"
        >
          {{ formatDuration(value) }}
        </button>
      </template>
      <template #column-fastest_frequency="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'frequency')"
        >
          {{ formatDuration(value) }}
        </button>
      </template>
      <template #column-slowest_frequency="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'frequency')"
        >
          {{ formatDuration(value) }}
        </button>
      </template>
      <template #column-earliest_trip_start="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ formatGtfsTime(value) }}
        </button>
      </template>
      <template #column-earliest_trip_end="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ formatGtfsTime(value) }}
        </button>
      </template>
      <template #column-latest_trip_start="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ formatGtfsTime(value) }}
        </button>
      </template>
      <template #column-latest_trip_end="{ value, row }">
        <button
          v-if="value != null && row.id != null"
          type="button"
          class="cal-report-cell-button"
          @click="handleOpenTimetable(row.id, 'trips')"
        >
          {{ formatGtfsTime(value) }}
        </button>
      </template>
    </cal-datagrid>
    <div class="cal-report-spacer" />
  </div>
</template>

<script setup lang="ts">
import type { TableReport, TableColumn } from './datagrid.vue'
import { stopToStopCsv, stopGeoAggregateCsv, routeToRouteCsv, agencyToAgencyCsv, type Route } from '~~/src/tl'
import type { ScenarioFilterResult } from '~~/src/scenario'
import { fmtDate, formatGtfsTime, formatDuration, CENSUS_COLUMNS, type DataDisplayMode, type Feature, type FilterTag } from '~~/src/core'

const props = defineProps<{
  filterTags: FilterTag[]
  censusGeographyLayerOptions: { label: string, value: string }[]
  scenarioFilterResult?: ScenarioFilterResult
  exportFeatures?: Feature[]
  flexDisplayFeatures?: Feature[]
}>()

const { aggregateLayer, onlyWithStops, dataDisplayMode, isAllDayMode } = useScenarioDisplay()
const { startDate, endDate, fixedRouteEnabled } = useScenarioInputs()

export type RouteTimetableTab = 'frequency' | 'trips' | 'stops'

const emit = defineEmits<{
  openTimetable: [payload: { route: Route, initialTab: RouteTimetableTab }]
}>()

function handleOpenTimetable (routeId: number, initialTab: RouteTimetableTab) {
  const route = props.scenarioFilterResult?.routes.find(r => r.id === routeId)
  if (route) {
    emit('openTimetable', { route, initialTab })
  }
}

/**
 * Features to export as GeoJSON based on current view mode
 * Uses exportFeatures from parent (map component)
 */
const downloadFeatures = computed((): Feature[] => {
  return props.exportFeatures || []
})

const reportHeading = computed(() => {
  if (!startDate.value || !endDate.value) {
    return 'Reports'
  }
  const sameMonthYear = fmtDate(startDate.value, 'MMM yyyy') === fmtDate(endDate.value, 'MMM yyyy')
  if (sameMonthYear) {
    return `Reports: ${fmtDate(startDate.value, 'dd')} - ${fmtDate(endDate.value, 'dd MMM, yyyy')}`
  }
  return `Reports: ${fmtDate(startDate.value, 'dd MMM, yyyy')} - ${fmtDate(endDate.value, 'dd MMM, yyyy')}`
})

type ReportTab = 'routes' | 'stops' | 'stops-aggregated' | 'agencies' | 'flex'

const activeReportTab = ref<ReportTab>('routes')

const hasAggregateLayer = computed(() => {
  return aggregateLayer.value !== '' && aggregateLayer.value !== 'none'
})

// Sync dataDisplayMode when user switches tabs
const modeMap: Record<ReportTab, DataDisplayMode> = {
  'routes': 'Transit mode',
  'stops': 'Stop visits',
  'stops-aggregated': 'Stop visits',
  'agencies': 'Agency',
  'flex': 'Service area',
}

watch(activeReportTab, (tab) => {
  dataDisplayMode.value = modeMap[tab]
})

watch(hasAggregateLayer, (has) => {
  if (!has && activeReportTab.value === 'stops-aggregated') {
    activeReportTab.value = 'stops'
  }
})

// Keep tab in sync if dataDisplayMode changes externally; immediate to set correct initial tab
watch(dataDisplayMode, (mode) => {
  if (mode === 'Transit mode' || mode === 'Route frequency') {
    activeReportTab.value = 'routes'
  } else if (mode === 'Stop visits' && activeReportTab.value !== 'stops-aggregated') {
    activeReportTab.value = 'stops'
  } else if (mode === 'Agency') {
    activeReportTab.value = 'agencies'
  } else if (mode === 'Service area') {
    activeReportTab.value = 'flex'
  }
}, { immediate: true })

const routeColumns = computed((): TableColumn[] => {
  const allDay = isAllDayMode.value
  const timeScope = allDay ? 'across all service days' : 'across all service days and times'
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
})

const stopColumns = computed((): TableColumn[] => {
  const allDay = isAllDayMode.value
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  return [
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
})

const censusColumns: TableColumn[] = CENSUS_COLUMNS.map(c => ({
  key: c.id,
  label: c.label,
  sortable: true,
  format: c.format,
}))

const stopGeoAggregateColumns = computed((): TableColumn[] => {
  const allDay = isAllDayMode.value
  const acrossDays = allDay ? 'across all calendar days' : 'across all calendar days and hours'
  return [
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
    ...censusColumns,
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
  return {
    data: stopGeoAggregateCsv(
      (props.scenarioFilterResult?.stops || []).filter(s => (s.marked)),
      aggregateLayer.value,
      props.scenarioFilterResult?.censusGeographies,
      { onlyWithStops: onlyWithStops.value },
    ),
    columns: stopGeoAggregateColumns.value
  }
})

const routesReportData = computed((): TableReport => {
  return {
    data: (props.scenarioFilterResult?.routes || []).filter(s => (s.marked)).map(routeToRouteCsv),
    columns: routeColumns.value
  }
})

const stopsReportData = computed((): TableReport => {
  return {
    data: (props.scenarioFilterResult?.stops || []).filter(s => s.marked).map(stopToStopCsv),
    columns: stopColumns.value
  }
})

const agenciesReportData = computed((): TableReport => {
  return {
    data: (props.scenarioFilterResult?.agencies || []).filter(s => s.marked).map(agencyToAgencyCsv),
    columns: agencyColumns
  }
})

const flexReportData = computed((): TableReport => {
  return {
    data: (props.flexDisplayFeatures || []).map(flexFeatureToCsv),
    columns: flexAreaColumns
  }
})

const activeTableReport = computed((): TableReport => {
  switch (activeReportTab.value) {
    case 'routes':
      return routesReportData.value
    case 'stops':
      return stopsReportData.value
    case 'stops-aggregated':
      return geoReportData.value
    case 'agencies':
      return agenciesReportData.value
    case 'flex':
      return flexReportData.value
    default:
      return { data: [], columns: [] }
  }
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
  }

  .cal-report-title-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .cal-report-filter-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .cal-report-spacer {
    min-height: 3rem;
  }

  .cal-report-cell-button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 2px;

    &:hover {
      text-decoration-style: solid;
    }
  }
</style>
