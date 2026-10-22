<template>
  <div ref="root" class="cal-transfer-report">
    <!-- What the report is about and how it is viewed come first, in one
         bar; the settings open below it, hung from it, on request. -->
    <div
      class="cal-transfer-report-bar"
      :class="{ 'cal-transfer-report-bar-open': panelOpen }"
    >
      <div class="cal-transfer-report-toolbar">
        <cat-field label="Stop or cluster" class="cal-transfer-report-subject">
          <cat-select v-model="subject">
            <option value="" disabled>
              Pick a stop or stop cluster
            </option>
            <optgroup v-if="subjectOptions.clusters.length" label="Stop clusters">
              <option v-for="o of subjectOptions.clusters" :key="o.key" :value="o.key">
                {{ o.label }}
              </option>
            </optgroup>
            <optgroup label="Stops">
              <option v-for="o of subjectOptions.stops" :key="o.key" :value="o.key">
                {{ o.label }}
              </option>
            </optgroup>
          </cat-select>
        </cat-field>
        <template v-if="hasSubject">
          <!-- Two views of the same transfers, as a toggle of tabs. -->
          <cat-field label="View" class="cal-transfer-report-view">
            <cat-tabs v-model="view" type="toggle">
              <cat-tab-item v-for="v of views" :key="v.value" :value="v.value" :label="v.label" />
            </cat-tabs>
          </cat-field>
          <!-- Which arrivals to show: one date at a time, in either view. -->
          <cat-field v-if="individualDates.length > 0" label="Date" class="cal-transfer-report-shrink">
            <cat-select
              :model-value="individualDate"
              @update:model-value="date = $event || undefined"
            >
              <option v-for="d of individualDates" :key="d" :value="d">
                {{ formatServiceDate(d) }}
              </option>
            </cat-select>
          </cat-field>
          <!-- The scenario's time of day, as the Filter tab sets it: arrivals
             between the two; either left empty, from or to the day's end. -->
          <cat-fieldset label="Time of day" class="cal-transfer-report-times">
            <div class="cal-transfer-report-times-row">
              <label>
                <span class="is-sr-only">Arrivals from</span>
                <cal-timepicker v-model="startTime" />
              </label>
              <span aria-hidden="true">to</span>
              <label>
                <span class="is-sr-only">Arrivals until</span>
                <cal-timepicker v-model="endTime" />
              </label>
            </div>
          </cat-fieldset>
          <!-- Each opens its settings below the toolbar, one at a time. -->
          <cat-field label="Settings" class="cal-transfer-report-settings-field">
            <div class="cal-transfer-report-settings-toggles">
              <cat-button
                v-for="t of settingsToggles"
                :key="t.section"
                :icon-left="t.icon"
                :variant="openSection === t.section ? 'primary' : undefined"
                :outlined="openSection === t.section"
                v-bind="{ 'aria-expanded': openSection === t.section, 'aria-controls': settingsId, 'title': t.label }"
                @click="openSection = openSection === t.section ? undefined : t.section"
              >
                <!-- Hidden but still read out where the toolbar is narrow, so
                   the toggles keep to its row as icons. -->
                <span class="cal-transfer-report-toggle-label">{{ t.label }}</span>
                <!-- The share of trips the filters keep, on the button's corner,
                   so it shows at a glance without widening the button; said
                   in full on hover and to screen readers. -->
                <span v-if="t.badge" class="tag is-rounded cal-transfer-report-badge" :title="t.badge.title">
                  <span aria-hidden="true">{{ t.badge.short }}</span>
                  <span class="is-sr-only">{{ t.badge.title }}</span>
                </span>
              </cat-button>
            </div>
          </cat-field>
          <!-- What the report can be saved as, from one menu. -->
          <cat-field label="Export" class="cal-transfer-report-download">
            <cat-dropdown position="bottom-right" @select="download">
              <template #trigger>
                <cat-button icon-left="download" :disabled="detailsLoading" v-bind="{ 'title': 'Export', 'aria-label': 'Export' }" />
              </template>
              <cat-dropdown-item value="summary">
                Summary as CSV
              </cat-dropdown-item>
              <cat-dropdown-item value="connections">
                Every connection as CSV
              </cat-dropdown-item>
              <cat-dropdown-item value="chart" :disabled="view !== 'individual'">
                Wait chart as SVG{{ view === 'individual' ? '' : ' (Individual view)' }}
              </cat-dropdown-item>
            </cat-dropdown>
          </cat-field>
        </template>
      </div>

      <!-- The subject's stops, to add to or take from: a station's other
         platform, say, that its cluster left out. -->
      <cal-transfer-stops
        v-if="hasSubject && openSection === 'stops'"
        v-bind="{ id: settingsId }"
        :model-value="stops"
        :map-stops="mapStops"
        :extent="extent"
        :fit-key="subject"
        @update:model-value="$emit('update:stops', $event)"
      />
      <cal-transfer-settings
        v-else-if="panelOpen"
        v-bind="{ id: settingsId }"
        v-model="settings"
        :section="openSection === 'trips' ? 'trips' : 'wait-walk'"
        :route-choices="routeChoices"
        :unknown-pairs="unknownPairs"
        @open-trips="$emit('openTrips', $event)"
      />
      <!-- The open panel hides from a slim strip along its bottom edge. -->
      <div v-if="panelOpen" class="cal-transfer-report-panel-strip">
        <button type="button" :aria-controls="settingsId" @click="openSection = undefined">
          <cat-icon icon="chevron-up" size="small" />
          Hide settings
        </button>
      </div>
    </div>

    <!-- Without clusters, only single stops can be picked, and a station's
         stops seldom serve both sides of a transfer. -->
    <p v-if="!hasClusters" class="cal-transfer-report-note">
      Stop clusters are off, so only single stops are listed; pick one and
      add other stops to it under Stops & platforms, or
      <cat-button size="small" class="ml-1" @click="$emit('enableClusters')">
        Turn on stop clusters and rerun
      </cat-button>
    </p>
    <p v-if="!hasSubject" class="cal-transfer-report-note">
      Pick a stop or stop cluster to see its transfers, or use "Enter Transfer
      Analyst" in a stop's or cluster's trip information on the map.
    </p>

    <template v-else>
      <p v-if="detailsError" class="cal-transfer-report-error">
        Could not load details for some trips: {{ detailsError }}
        <cat-button size="small" class="ml-2" @click="$emit('retry')">
          Retry
        </cat-button>
      </p>
      <p v-else-if="detailsLoading" class="cal-transfer-report-note">
        Loading trip details{{ missingDetails > 0 ? `: ${missingDetails.toLocaleString()} trips to go` : '' }}…
      </p>
      <p v-else-if="missingDetails > 0" class="cal-transfer-report-note">
        Details for {{ missingDetails.toLocaleString() }} {{ missingDetails === 1 ? 'trip' : 'trips' }} could not be found, so {{ missingDetails === 1 ? 'its' : 'their' }} transfers are left out.
      </p>

      <p v-if="view === 'individual' && individualDates.length === 0" class="cal-transfer-report-note">
        No trips arrive here within the filters.
      </p>
      <template v-else>
        <!-- The view's key figures beside a bar of its connections by grade. -->
        <div class="cal-transfer-report-overview">
          <dl class="cal-transfer-report-figures">
            <div v-for="f of figures(overview)" :key="f.label">
              <dt>
                <cat-tooltip :text="f.tooltip">
                  {{ f.label }}
                </cat-tooltip>
              </dt>
              <dd>{{ f.value }}</dd>
            </div>
          </dl>
          <cal-plot class="cal-transfer-report-grades" :options="gradeBar" :label="gradeChartLabel(overview.grades)" />
        </div>
        <cal-plot v-if="view === 'individual'" class="cal-transfer-report-wait-chart" :options="waitChart" label="Each connection's wait by the time its trip arrives, colored by grade" />
        <!-- One grid for either view, keyed so each starts on its first page
             and its own sort; slots for columns it lacks go unused. -->
        <cal-datagrid
          :key="view"
          fill
          dense
          :searchable="false"
          :downloadable="false"
          :per-page="100"
          scroll
          :reset-key="`${subject}|${individualDate ?? ''}`"
          :loading="detailsLoading"
          group-key="group"
          :group-label="(row: TransferGridTrip) => `${row.route_name} ${row.headsign}`"
          v-bind="grid"
        >
          <!-- The trip: its route, its destination, where an arriving one
               comes from, and its tags. The grid's hidden sizing row carries
               no tags, so is guarded. -->
          <template #column-route_name="{ row }">
            <span v-if="row.route_name" class="cal-transfer-report-trip">
              <cal-route-badge :label="row.route_name" :title="row.agency_name" />
              <span class="cal-transfer-report-clip" :title="row.headsign">{{ row.headsign }}</span>
              <span v-if="row.origin" class="cal-transfer-report-origin cal-transfer-report-clip" :title="`From ${row.origin}`">from {{ row.origin }}</span>
              <span v-for="tag of row.tags ?? []" :key="tag.label" class="tag is-light cal-transfer-report-tag" :title="tag.title">
                {{ tag.label }}<span class="is-sr-only">: {{ tag.title }}</span>
              </span>
            </span>
          </template>
          <template #column-stop_name="{ value }">
            <span class="cal-transfer-report-clip cal-transfer-report-stop" :title="value">{{ value }}</span>
          </template>
          <template #column-time="{ value }">
            <span class="cal-transfer-report-time">{{ tripTimeLabel(value) }}</span>
          </template>
          <template v-for="key of DURATION_COLUMNS" :key="key" #[`column-${key}`]="{ value }">
            <span class="cal-transfer-report-time">{{ value === '' ? '' : formatWait(value) }}</span>
          </template>
          <!-- A grade's count highlighted in its color; blank where none, so
               the grid does not print the 0. -->
          <template v-for="g of TRANSFER_GRADES" :key="g" #[`column-${g}`]="{ value }">
            <span :class="{ 'cal-transfer-report-count': value > 0 }" :style="value > 0 ? { background: gradeTint(g) } : undefined">{{ value > 0 ? value.toLocaleString() : '' }}</span>
          </template>
          <template #column-arrivals="{ value }">
            <span class="cal-transfer-report-time">{{ value === '' ? '' : value.toLocaleString() }}</span>
          </template>
          <!-- The share as a bar on a 0 to 100% track: the close part, then
               the acceptable part, in their grade colors. -->
          <template #column-close_or_acceptable_share="{ value, row }">
            <span class="cal-transfer-report-share">
              <span
                class="cal-transfer-report-share-track"
                :title="`Close ${row.close_share}%, acceptable ${row.acceptable_share}%`"
                aria-hidden="true"
              >
                <span class="cal-transfer-report-share-bar" :style="{ width: `${row.close_share}%`, background: TRANSFER_GRADE_COLORS.close.fill }" />
                <span class="cal-transfer-report-share-bar" :style="{ width: `${row.acceptable_share}%`, background: TRANSFER_GRADE_COLORS.acceptable.fill }" />
              </span>
              <span class="cal-transfer-report-time">{{ value }}%</span>
            </span>
          </template>
          <!-- The grade is the wait's color, and text for screen readers. The
               grid's hidden sizing row has no grade, so is guarded too. -->
          <template #column-wait_seconds="{ row }">
            <span
              v-if="waitStyle(row.grade)"
              class="cal-transfer-report-wait"
              :style="waitStyle(row.grade)"
              :title="row.grade_label"
            >{{ formatWait(row.wait_seconds) }}<span class="is-sr-only">, {{ row.grade_label }}</span></span>
            <span v-else class="cal-transfer-report-none">{{ row.grade_label }}</span>
          </template>
        </cal-datagrid>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { TransferSettingsSection } from './transfer-settings.vue'
import type { TransferMapStop } from './transfer-stops-map.vue'
import * as Plot from '@observablehq/plot'
import {
  type TransferOverview,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  formatWait,
  tripTimeLabel,
  type TransferGrade,
  type TransferGradeCount,
  type TransferGridRow,
  type TransferGridTrip,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferSummaryGridRow,
} from '~~/src/scenario'
import { formatGtfsTime, formatServiceDate, type TableColumn, type TableReport } from '~~/src/core'
import { transferSubjectFromKey } from '~/composables/useSubjectTransfers'

export type TransferReportView = 'summary' | 'individual'
export type TransferReportSection = TransferSettingsSection | 'stops'

const props = defineProps<{
  // What the transfers are at, as the downloads' file names.
  title: string
  // The stops and clusters the report can be about, as picker options.
  subjectOptions: { clusters: { key: string, label: string }[], stops: { key: string, label: string }[] }
  // The stops the transfers are at: the subject's, as changed; and every stop
  // that can be added.
  stops: number[]
  mapStops: TransferMapStop[]
  // The query's area, which the stops were loaded from.
  extent: GeoJSON.Feature[]
  // Whether the scenario has stop clusters.
  hasClusters: boolean
  // Each view's rows, nested: an arriving trip (or destination), then the
  // departing ones it connects to.
  summaryGrid: TransferSummaryGridRow[]
  // Each view's rows, flat, as CSV, built when asked for. Only the view
  // shown has its grid and chart points.
  csvRows: (kind: 'summary' | 'connections') => Record<string, unknown>[]
  // The date's figures, as both views show them.
  overview: TransferOverview
  individualDates: string[]
  individualDate?: string
  individualGrid: TransferGridRow[]
  individualPoints: { hour: number, waitMinutes: number, grade: TransferGrade }[]
  // The breakpoints in use, in seconds.
  breakpoints: number[]
  // The routes arriving and departing, and pairs of stops with no distance
  // between them, for the settings.
  routeChoices: { from: TransferRouteChoice[], to: TransferRouteChoice[] }
  unknownPairs: number
  missingDetails: number
  detailsLoading: boolean
  detailsError: string | null
}>()

defineEmits<{
  // Fetch the details that did not arrive.
  'retry': []
  // Show a route's trips.
  'openTrips': [routeId: number]
  // The stops picked, or the subject's own again.
  'update:stops': [stopIds: number[]]
  // Turn on stop clustering, and run the scenario again.
  'enableClusters': []
}>()

// The picked stop or cluster, as "stop:<id>" or "cluster:<id>"; blank for none.
const subject = defineModel<string>('subject', { required: true })
const hasSubject = computed(() => !!transferSubjectFromKey(subject.value))
const view = defineModel<TransferReportView>('view', { default: 'summary' })
const date = defineModel<string | undefined>('date')
// The scenario's time of day, shared with the Filter tab, through the URL.
const { startTime, endTime } = useScenarioFilters()
const settings = defineModel<TransferSettings>('settings', { required: true })
// The settings panel open, one at a time, or none: the page starts it at
// Trip filtering, and opens Stops & platforms on entering from a cluster.
const openSection = defineModel<TransferReportSection | undefined>('section', { required: true })
// The open panel, while there is a subject to show it for.
const panelOpen = computed(() => hasSubject.value && !!openSection.value)
const settingsId = useId()

// The share of trips, arriving and departing, that trip filtering keeps, on
// its button while it keeps less than all of them.
const tripsKept = computed(() => {
  let total = 0
  let kept = 0
  const tally = (routes: TransferRouteChoice[], excluded: string[]) => {
    const out = new Set(excluded)
    for (const d of routes.flatMap(r => r.directions.flatMap(dir => dir.destinations))) {
      total += d.count
      kept += out.has(d.key) ? 0 : d.count
    }
  }
  tally(props.routeChoices.from, settings.value.excludedFrom)
  tally(props.routeChoices.to, settings.value.excludedTo)
  return { total, kept }
})
const tripsKeptBadge = computed(() => {
  const { total, kept } = tripsKept.value
  if (total === 0 || kept === total) {
    return undefined
  }
  // Rounded down, so it never reads 100% while any trip is left out.
  const percent = Math.floor((kept / total) * 100)
  return { short: `${percent}%`, title: `${percent}% of trips match the trip filters (${kept.toLocaleString()} of ${total.toLocaleString()})` }
})
// The count of stops picked, on its button.
const stopsBadge = computed(() => ({ short: String(props.stops.length), title: `${props.stops.length} ${props.stops.length === 1 ? 'stop' : 'stops'} picked` }))
const settingsToggles = computed((): { section: TransferReportSection, label: string, icon: string, badge?: { short: string, title: string } }[] => [
  { section: 'stops', label: 'Stops & platforms', icon: 'map-marker-multiple', badge: stopsBadge.value },
  { section: 'wait-walk', label: 'Wait & walking', icon: 'tune' },
  { section: 'trips', label: 'Trip filtering', icon: 'filter-variant', badge: tripsKeptBadge.value },
])

const views: { value: TransferReportView, label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'individual', label: 'Individual' },
]

function minutes (seconds: number): number {
  return seconds / 60
}

// The columns that share a slot; the grade counts' columns are keyed by
// their grades.
const DURATION_COLUMNS = ['walk_seconds', 'median_wait_seconds']

// A wait's colors by its grade; none for an arrival's own row.
function waitStyle (grade: TransferGridRow['grade'] | undefined) {
  const colors = grade && grade !== 'none' ? TRANSFER_GRADE_COLORS[grade] : undefined
  return colors && { background: colors.fill, color: colors.text }
}

// A grade's color, faint enough to read text on in either theme.
function gradeTint (grade: TransferGrade): string {
  return `${TRANSFER_GRADE_COLORS[grade].fill}40`
}

const gradeColor = {
  domain: [...TRANSFER_GRADES],
  range: TRANSFER_GRADES.map(g => TRANSFER_GRADE_COLORS[g].fill),
}

function percent (share: number): string {
  return `${Math.round(share * 100)}%`
}

// The overview's figures, by name.
function figures (o: TransferOverview) {
  return [
    { label: 'Arrivals', value: o.arrivals.toLocaleString(), tooltip: 'Trips arriving at the stops within the filters.' },
    { label: 'Connections', value: o.connections.toLocaleString(), tooltip: 'Connections shown, by grade in the bar.' },
    { label: 'Close or acceptable', value: percent(o.closeOrAcceptableShare), tooltip: 'Share of arrivals whose soonest connection, on any route, is close or acceptable.' },
    { label: 'Median wait', value: formatWait(o.medianWait) || '—', tooltip: 'Median wait for each arrival\'s soonest connection, over arrivals that make one.' },
  ]
}

// Connections by grade as one bar, in order of wait, each grade labeled
// where it has room.
function gradeChart (counts: TransferGradeCount[]) {
  let x = 0
  const segments = counts.map((c) => {
    const segment = { ...c, x1: x, x2: x + c.count }
    x += c.count
    return segment
  })
  const label = (d: TransferGradeCount) => `${TRANSFER_GRADE_LABELS[d.grade]} ${d.count.toLocaleString()} (${percent(d.share)})`
  return (width: number): Plot.PlotOptions => ({
    height: 36,
    margin: 0,
    x: { axis: null, domain: [0, Math.max(1, x)] },
    color: gradeColor,
    marks: [
      Plot.barX(segments, { x1: 'x1', x2: 'x2', fill: 'grade', title: label, insetRight: 1 }),
      // A grade's label where its segment is wide enough to hold it.
      ...TRANSFER_GRADES.map(grade => Plot.text(
        segments.filter(s => s.grade === grade && (s.count / Math.max(1, x)) * width > label(s).length * 6.5 + 8),
        { x: (s: typeof segments[number]) => (s.x1 + s.x2) / 2, text: label, fill: TRANSFER_GRADE_COLORS[grade].text, fontWeight: 600 },
      )),
    ],
  })
}

// The date's grade bar, which redraws when its figures change.
const gradeBar = computed(() => gradeChart(props.overview.grades))

function gradeChartLabel (counts: TransferGradeCount[]): string {
  return `Connections by grade: ${counts.map(c => `${TRANSFER_GRADE_LABELS[c.grade]} ${c.count} (${percent(c.share)})`).join(', ')}`
}

// An hour of the day, with its minutes: "09:30".
function hourLabel (hour: number): string {
  return formatGtfsTime(Math.round(hour * 60) * 60)
}

// The downloads, named for the subject and date.
const root = ref<HTMLElement>()
function download (what: 'summary' | 'connections' | 'chart') {
  const name = `transfers-${what}-${props.individualDate ?? ''}-${props.title}`
  if (what === 'summary' || what === 'connections') {
    saveBlob(csvBlob(props.csvRows(what)), `${name}.csv`)
  } else {
    const svg = root.value?.querySelector('.cal-transfer-report-wait-chart svg')
    if (svg) {
      const clone = svg.cloneNode(true) as SVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      saveBlob(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }), `${name}.svg`)
    }
  }
}

// Each connection's wait by the time its trip arrives. The points and
// breakpoints are read here, not in the returned options, so the chart
// redraws when they change.
const waitChart = computed(() => {
  const points = props.individualPoints
  const bp = props.breakpoints
  return (): Plot.PlotOptions => ({
    height: 120,
    marginTop: 8,
    marginLeft: 56,
    x: { label: null, tickFormat: hourLabel },
    // The grade bar above is the legend.
    y: { label: null, grid: true, ticks: bp.map(minutes), tickFormat: (m: number) => `${m} min`, domain: [minutes(bp[0]!), minutes(bp[bp.length - 1]!)] },
    color: gradeColor,
    marks: [
      Plot.ruleY([0], { strokeOpacity: 0.5 }),
      Plot.dot(points, { x: 'hour', y: 'waitMinutes', fill: 'grade', r: 2.5 }),
    ],
  })
})

// Columns as wide as their contents, and the grade counts centered too, so
// the From and To columns take the rest.
const NARROW = { shrink: true }
const COUNT = { shrink: true, align: 'center' as const }

const TRIP_COLUMN: TableColumn = {
  key: 'route_name',
  label: 'Incoming trip / Outgoing trip',
  sortable: true,
  tooltip: 'Each incoming trip by route and destination, and where it comes from, with the outgoing trips riders connect to beneath it. Sorting orders the incoming trips, and the outgoing trips under each.',
}

// The trips, incoming and outgoing, and the incoming trips' arrivals; the
// departures each arrival could take, by how long the wait; and the first
// connection made.
const TRIPS = { key: 'trips', label: 'Trips' }
const CONNECTIONS = { key: 'connections', label: 'Connections by wait', tooltip: 'Departures within reach of each arrival, counted by the grade of the wait.' }
const FIRST = { key: 'first', label: 'First connection', tooltip: 'The soonest departure each arrival makes: for an incoming trip, on any route; for an outgoing trip, on it.' }

// An incoming trip's figures sum up the outgoing trips under it, so show only
// while its group is closed.
const summaryColumns: TableColumn[] = [
  { ...TRIP_COLUMN, group: TRIPS },
  { key: 'arrivals', label: 'Arrivals', sortable: true, numeric: true, tooltip: 'Trips arriving on this route and destination.', ...NARROW, group: TRIPS },
  ...TRANSFER_GRADES.map(g => ({ key: g, label: TRANSFER_GRADE_LABELS[g], sortable: true, numeric: true, ...COUNT, group: CONNECTIONS, groupSummary: true })),
  { key: 'close_or_acceptable_share', label: 'Close or acceptable', sortable: true, numeric: true, tooltip: 'Share of arrivals whose first connection is close or acceptable.', group: FIRST, groupSummary: true },
  { key: 'median_wait_seconds', label: 'Median wait', sortable: true, numeric: true, tooltip: 'Median wait for the first connection, over arrivals that make one.', ...NARROW, group: FIRST, groupSummary: true },
]

// The Individual table's columns, with the stop where there are several.
// Apart from its rows, so the grid keeps its sort as rows change.
// Each trip, when and where; then the transfer to it, walking and waiting.
const TRIP = { key: 'trip', label: 'Trip' }
const TRANSFER = { key: 'transfer', label: 'Transfer', tooltip: 'From the incoming trip to the outgoing one: the walk between their stops, then the wait.' }
const individualColumns = computed((): TableColumn[] => [
  { key: 'time', label: 'Time', sortable: true, tooltip: 'When the trip arrives, or for a departing trip beneath it, leaves.', ...NARROW, group: TRIP },
  { ...TRIP_COLUMN, tooltip: 'Each incoming trip, and where it comes from, with its connections beneath it.', group: TRIP },
  ...(props.stops.length > 1 ? [{ key: 'stop_name', label: 'Stop', sortable: true, group: TRIP }] : []),
  { key: 'walk_seconds', label: 'Walk', sortable: true, numeric: true, ...NARROW, group: TRANSFER },
  { key: 'wait_seconds', label: 'Wait', sortable: true, numeric: true, tooltip: 'Time between reaching the departing stop and the departure, colored by grade. Negative when missed.', ...NARROW, group: TRANSFER },
])

// The shown view's table; its CSV downloads are the Export menu's.
const grid = computed(() => (view.value === 'summary'
  ? {
      tableReport: { columns: summaryColumns, data: props.summaryGrid } as TableReport,
      caption: 'Transfers by route',
    }
  : {
      tableReport: { columns: individualColumns.value, data: props.individualGrid } as TableReport,
      caption: 'Transfers',
    }))
</script>

<style scoped lang="scss">
// Fills the Reports tab's height: the controls and charts at their own
// height, and the table the rest, scrolling inside.
.cal-transfer-report {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  // The toolbar fits its controls to this width.
  container-type: inline-size;
}

.cal-transfer-report-subject :deep(select) {
  // Not as wide as its longest option, so the toolbar keeps to one line.
  width: 16rem;
}

// Narrower, the stop picker narrows and the settings toggles show only their
// icons, so the controls stay on one row; on a phone, they wrap.
@container (max-width: 84rem) {
  .cal-transfer-report-subject :deep(select) {
    width: 12rem;
  }

  .cal-transfer-report-toggle-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

// The controls as an action bar; an open panel hangs from it, the two as
// one surface.
.cal-transfer-report-bar {
  flex: 0 0 auto;
  margin-bottom: 0.75rem;

  // The panels framed here, as they only ever open from the bar.
  > .cal-transfer-settings,
  > .cal-transfer-stops {
    border: 1px solid var(--bulma-border);
    border-top: 0;
    background: var(--bulma-scheme-main);
  }

  &.cal-transfer-report-bar-open .cal-transfer-report-toolbar {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
}

.cal-transfer-report-panel-strip {
  display: flex;
  border: 1px solid var(--bulma-border);
  border-top: 0;
  border-radius: 0 0 var(--bulma-radius) var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  overflow: hidden;

  button {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.1rem 0;
    border: 0;
    background: none;
    color: var(--bulma-text-weak);
    font: inherit;
    font-size: 0.75rem;
    cursor: pointer;

    &:hover {
      background: var(--bulma-scheme-main-ter);
      color: var(--bulma-text-strong);
    }

    &:focus-visible {
      outline: 2px solid var(--bulma-primary);
      outline-offset: -2px;
    }
  }
}

.cal-transfer-report-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: flex-end;
  gap: 0.5rem 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);

  // On a phone, the controls wrap.
  @container (max-width: 52rem) {
    flex-wrap: wrap;
  }

  // The controls at their own width; only the selects give way.
  > * {
    flex-shrink: 0;
  }

  > .cal-transfer-report-subject,
  > .cal-transfer-report-shrink {
    flex-shrink: 1;
    min-width: 7rem;

    :deep(.select),
    :deep(select) {
      max-width: 100%;
    }
  }

  > .cal-transfer-report-subject {
    min-width: 9rem;
  }

  :deep(.field) {
    margin-bottom: 0;
  }

  // Small labels, as a bar's: the controls carry the weight.
  :deep(.label) {
    margin-bottom: 0.2rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--bulma-text-weak);
  }
}

.cal-transfer-report-times {
  margin-bottom: 0;

  // The two times on one line, with "to" between.
  .cal-transfer-report-times-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  :deep(input) {
    width: 7.5rem;
  }
}

.cal-transfer-report-view :deep(.cat-tabs) {
  margin-bottom: 0;
}

.cal-transfer-report-settings-field {
  margin-left: auto;
}

.cal-transfer-report-settings-toggles {
  display: flex;
  gap: 0.5rem;

  // The badge sits on the button's corner.
  :deep(.button) {
    position: relative;
    overflow: visible;
  }
}

.cal-transfer-report-badge {
  position: absolute;
  top: -0.6rem;
  right: -0.6rem;
  height: 1.35rem;
  padding: 0 0.45rem;
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 0 0 2px var(--bulma-scheme-main);
  pointer-events: none;
}

// The figures and the grade bar, one row.
.cal-transfer-report-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 2rem;
  margin-bottom: 0.75rem;
  flex: 0 0 auto;
}

.cal-transfer-report-figures {
  display: flex;
  gap: 1.5rem;
  margin: 0;

  dt {
    font-size: 0.75rem;
    color: var(--bulma-text-weak);
  }

  dd {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--bulma-text-strong);
  }
}

.cal-transfer-report-grades {
  flex: 1 1 24rem;
  margin: 0;
}

.cal-transfer-report-error {
  color: var(--bulma-danger);
  margin-bottom: 1rem;
}

.cal-transfer-report-note {
  color: var(--bulma-text-weak);
  margin-bottom: 1rem;
}

.cal-transfer-report-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

// Long headsigns and stop names are cut short, whole on hover, so each row
// stays one line and the table fits the page.
.cal-transfer-report-clip {
  display: inline-block;
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.cal-transfer-report-stop {
  max-width: 12rem;
}

.cal-transfer-report-share {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.cal-transfer-report-share-track {
  display: inline-flex;
  width: 4rem;
  height: 0.5rem;
  border-radius: 999px;
  background: var(--bulma-scheme-main-ter);
  overflow: hidden;
}

.cal-transfer-report-share-bar {
  display: block;
  height: 100%;
}

// The grid's cells, outside this component's scope.
.cal-transfer-report-count {
  display: inline-block;
  min-width: 2.25em;
  padding: 0 0.4em;
  border-radius: 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cal-transfer-report-wait {
  display: inline-block;
  min-width: 3.5em;
  padding: 0 0.4em;
  border-radius: 4px;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

// An arrival with no connection, said plainly.
.cal-transfer-report-none {
  color: var(--bulma-text-weak);
  font-weight: normal;
}

.cal-transfer-report-trip {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
}

.cal-transfer-report-origin {
  color: var(--bulma-text-weak);
  font-weight: normal;
  max-width: 12rem;
}

.cal-transfer-report-tag {
  font-weight: normal;
  height: 1.5em;
  font-size: 0.75rem;
}
</style>
