<template>
  <div ref="root">
    <!-- The subject, date, and times, then the view and its settings, which
         open below on request. -->
    <div class="mb-6">
      <!-- Where, on which date, and at what times of day. -->
      <div class="cal-transfer-report-row">
        <cat-field label="Station or stop cluster" class="mb-0">
          <cat-select v-model="subjectChoice">
            <option value="" disabled>
              Pick a station or stop cluster
            </option>
            <!-- Shown when the picked stops differ from the subject's own;
                 picking the subject again restores its own stops. -->
            <option v-if="customFrom !== undefined" value="custom" disabled>
              Custom: {{ stops.length }} {{ stops.length === 1 ? 'stop' : 'stops' }} (from {{ customFrom }})
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
          <!-- Which arrivals to show: one date at a time, in either view. -->
          <cat-field v-if="individualDates.length > 0" label="Date" class="mb-0">
            <cat-select
              :model-value="individualDate"
              @update:model-value="date = $event || undefined"
            >
              <option v-for="d of individualDates" :key="d" :value="d">
                {{ formatServiceDate(d) }}
              </option>
            </cat-select>
          </cat-field>
          <!-- The scenario's time of day, shared with the Filter tab: arrivals
               between the two times, an empty one meaning the day's start or
               end. -->
          <cat-fieldset label="Time of day">
            <div class="is-flex is-align-items-center is-gap-1">
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
        </template>
      </div>
      <!-- The view, its settings, and Share. -->
      <div v-if="hasSubject" class="cal-transfer-report-row mt-4">
        <cat-tabs v-model="view" type="toggle" class="cal-transfer-report-view" v-bind="{ ariaLabel: 'View' }">
          <cat-tab-item v-for="v of views" :key="v.value" :value="v.value" :label="v.label" :icon="v.icon" />
        </cat-tabs>
        <!-- The settings, each opening below the toolbar, one at a time,
             then Share. -->
        <div class="buttons ml-auto">
          <cat-button
            v-for="t of settingsToggles"
            :key="t.section"
            :icon-left="t.icon"
            :variant="openSection === t.section ? 'primary' : undefined"
            :outlined="openSection === t.section"
            v-bind="{ 'aria-expanded': openSection === t.section, 'aria-controls': settingsId }"
            @click="openSection = openSection === t.section ? undefined : t.section"
          >
            {{ t.label }}
            <!-- The share of trips the filters keep, on the button's corner,
                 so it shows at a glance without widening the button; said in
                 full on hover and to screen readers. -->
            <span v-if="t.badge" class="tag is-rounded cal-transfer-report-badge" :title="t.badge.title">
              <span aria-hidden="true">{{ t.badge.short }}</span>
              <span class="is-sr-only">{{ t.badge.title }}</span>
            </span>
          </cat-button>
          <cat-dropdown position="bottom-right" @select="download">
            <template #trigger>
              <cat-button icon-left="share-variant">
                Share
              </cat-button>
            </template>
            <cat-dropdown-item value="link">
              Copy link to this view
            </cat-dropdown-item>
            <cat-dropdown-item value="summary" :disabled="detailsLoading">
              Download summary report (CSV)
            </cat-dropdown-item>
            <cat-dropdown-item value="connections" :disabled="detailsLoading">
              Download individual report (CSV)
            </cat-dropdown-item>
            <!-- The chart as drawn, so only from the Individual view. -->
            <cat-dropdown-item value="wait-chart" :disabled="view !== 'individual' || detailsLoading">
              Download wait chart (SVG){{ view === 'individual' ? '' : ' (Individual view)' }}
            </cat-dropdown-item>
          </cat-dropdown>
        </div>
      </div>

      <!-- The open settings panel, framed below the toolbar; the strip along
           its bottom edge hides the panel. -->
      <div v-if="panelOpen" :id="settingsId" class="cal-transfer-report-panel">
        <!-- Add or remove the subject's stops, such as a station's other
             platform that its cluster omits. -->
        <cal-transfer-stops
          v-if="openSection === 'stops'"
          :model-value="stops"
          :map-stops="mapStops"
          :map-routes="mapRoutes"
          :extent="extent"
          :fit-key="subject"
          @update:model-value="$emit('update:stops', $event)"
        />
        <cal-transfer-settings
          v-else
          v-model="settings"
          :section="openSection === 'trips' ? 'trips' : 'wait-walk'"
          :route-choices="routeChoices"
          :unknown-pairs="unknownPairs"
          @open-trips="$emit('openTrips', $event)"
        />
        <button type="button" class="cal-transfer-report-panel-strip" :aria-controls="settingsId" @click="openSection = undefined">
          <cat-icon icon="chevron-up" size="small" />
          Hide settings
        </button>
      </div>
    </div>

    <!-- Before a subject is picked: how to start and, with clustering off, why
         only single stops are listed (a station's stops seldom serve both
         sides of a transfer). Once one is picked, Stops & platforms changes
         its stops, so neither shows. -->
    <div v-if="!hasSubject" class="columns">
      <div class="column">
        <cat-msg variant="info" title="Pick where to look" class="content">
          <p>Choose a station or stop cluster above, or:</p>
          <ul>
            <li>On the map, open a stop's or cluster's trip information and choose Enter Transfer Analyst.</li>
            <li>In Stop Clusters, use a row's Transfer Analyst link.</li>
          </ul>
        </cat-msg>
      </div>
      <div v-if="clusteringOff" class="column">
        <cat-msg variant="warning" title="Stop clusters are off">
          <p class="mb-3">
            Only single stops are listed. Pick one and add others under Stops &
            platforms, or group nearby stops into clusters.
          </p>
          <cat-button @click="$emit('enableClusters')">
            Turn on stop clusters
          </cat-button>
        </cat-msg>
      </div>
    </div>

    <template v-if="hasSubject">
      <p v-if="detailsError" class="has-text-danger mb-4">
        Could not load details for some trips: {{ detailsError }}
        <cat-button class="ml-2" @click="$emit('retry')">
          Retry
        </cat-button>
      </p>
      <p v-else-if="detailsLoading" class="has-text-grey mb-4">
        Loading trip details{{ missingDetails > 0 ? `: ${missingDetails.toLocaleString()} trips to go` : '' }}…
      </p>
      <p v-else-if="missingDetails > 0" class="has-text-grey mb-4">
        Details for {{ missingDetails.toLocaleString() }} {{ missingDetails === 1 ? 'trip' : 'trips' }} could not be found, so {{ missingDetails === 1 ? 'its' : 'their' }} transfers are left out.
      </p>

      <p v-if="stops.length === 0" class="has-text-grey mb-4">
        No stops are picked; pick some under Stops & platforms.
      </p>
      <p v-else-if="individualDates.length === 0" class="has-text-grey mb-4">
        No trips arrive here within the filters.
      </p>
      <template v-else>
        <!-- Dates are listed by departures, read before trips' details, so a
             date whose trips only start here has none arriving; where details
             failed or are missing, the note above says why instead. -->
        <p v-if="overview.arrivals === 0 && !detailsLoading && !detailsError && missingDetails === 0" class="has-text-grey mb-4">
          No trips arrive here on this date within the filters.
        </p>
        <!-- Departures are loaded for the query's dates alone. -->
        <p v-if="midnightCut" class="has-text-grey mb-4">
          {{ midnightCut === 'after'
            ? 'Departures after midnight fall past the query\'s last date, so connections onto them are left out; end the query a day later to count them.'
            : 'Departures before midnight fall before the query\'s first date, so connections missed just after midnight are left out; start the query a day earlier to count them.' }}
        </p>
        <!-- The view's key figures beside a bar of its connections by grade. -->
        <div class="columns is-vcentered">
          <dl class="column is-narrow is-flex is-gap-3">
            <div v-for="f of figures(overview)" :key="f.label">
              <dt class="has-text-grey">
                <cat-tooltip :text="f.tooltip">
                  {{ f.label }}
                </cat-tooltip>
              </dt>
              <dd class="has-text-weight-semibold">
                {{ f.value }}
              </dd>
            </div>
          </dl>
          <cal-plot class="column mb-0 cal-transfer-report-grades" :options="gradeBar" :label="gradeChartLabel(overview.grades)" />
        </div>
        <cal-plot v-if="view === 'individual'" class="cal-transfer-report-wait-chart" :options="waitChart" label="Each connection's wait by the time its trip arrives, colored by grade" />
        <!-- One grid for Summary or Individual, keyed so each starts on its
             first page and its own sort; slots for columns it lacks go
             unused. -->
        <cal-datagrid
          :key="view"
          sticky-header
          :searchable="false"
          :downloadable="false"
          :per-page="100"
          scroll
          :reset-key="`${subject}|${individualDate ?? ''}`"
          :loading="detailsLoading"
          group-key="group"
          :group-label="tripName"
          empty-group-note="No outgoing trips within the current settings"
          v-bind="grid"
        >
          <!-- The trip: its route, then its destination, an arriving trip's
               origin, and its tags as icons, wrapping beside the route. In
               Summary, the destination links to the row's arrivals and
               connections in Individual. The grid's hidden sizing row carries
               no tags, so is guarded. -->
          <template #column-route_name="{ row }">
            <span v-if="row.route_name" class="cal-transfer-report-trip">
              <cal-route-badge :label="row.route_name" :title="row.agency_name" />
              <cat-tooltip v-if="view === 'summary'" :text="showTooltip(row as TransferGridTrip)">
                <button type="button" class="cal-link-button" @click="showRow(row as TransferSummaryGridRow)">{{ row.headsign }}</button>
              </cat-tooltip>
              <cat-tooltip v-else-if="row.sign && row.sign !== row.headsign" :text="`Signed ${row.sign}`">{{ row.headsign }}</cat-tooltip>
              <span v-else>{{ row.headsign }}</span>
              <span v-if="row.origin" class="has-text-grey has-text-weight-normal">from {{ row.origin }}</span>
              <cal-transfer-trip-tags :tags="row.tags ?? []" />
            </span>
          </template>
          <template #column-stop_name="{ value }">
            <span class="cal-transfer-report-stop" :title="value">{{ value }}</span>
          </template>
          <template #column-time="{ value }">
            {{ tripTimeLabel(value) }}
          </template>
          <template v-for="key of DURATION_COLUMNS" :key="key" #[`column-${key}`]="{ value }">
            {{ value === '' ? '' : formatWait(value) }}
          </template>
          <!-- A grade's count highlighted in its color; blank where none, so
               the grid does not print the 0. -->
          <template v-for="g of TRANSFER_GRADES" :key="g" #[`column-${g}`]="{ value }">
            <span :class="{ 'cal-transfer-report-chip': value > 0 }" :style="value > 0 ? { background: gradeTint(g) } : undefined">{{ value > 0 ? value.toLocaleString() : '' }}</span>
          </template>
          <template #column-arrivals="{ value }">
            {{ value === '' ? '' : value.toLocaleString() }}
          </template>
          <!-- The share as a bar on a 0 to 100% track: the close part, then
               the acceptable part, in their grade colors. -->
          <template #column-close_or_acceptable_share="{ value, row }">
            <span class="is-inline-flex is-align-items-center is-gap-1">
              <span
                class="cal-transfer-report-share-track"
                :title="`Close ${row.close_share}%, acceptable ${row.acceptable_share}%`"
                aria-hidden="true"
              >
                <span class="cal-transfer-report-share-bar" :style="{ width: `${row.close_share}%`, background: TRANSFER_GRADE_COLORS.close.fill }" />
                <span class="cal-transfer-report-share-bar" :style="{ width: `${row.acceptable_share}%`, background: TRANSFER_GRADE_COLORS.acceptable.fill }" />
              </span>
              {{ value }}%
            </span>
          </template>
          <!-- The grade is the wait's color, and text for screen readers. The
               grid's hidden sizing row has no grade, so is guarded too. -->
          <template #column-wait_seconds="{ row }">
            <span
              v-if="waitStyle(row.grade)"
              class="cal-transfer-report-chip"
              :style="waitStyle(row.grade)"
              :title="row.grade_label"
            >{{ formatWait(row.wait_seconds) }}<span class="is-sr-only">, {{ row.grade_label }}</span></span>
          </template>
        </cal-datagrid>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { TransferSettingsSection } from './settings.vue'
import type { TransferMapRoute, TransferMapStop } from './stops-map.vue'
import * as Plot from '@observablehq/plot'
import {
  type TransferOverview,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  choiceDestinations,
  focusFilters,
  formatWait,
  tripTimeLabel,
  type TransferGrade,
  type TransferFocus,
  type TransferGradeCount,
  type TransferGridRow,
  type TransferGridTrip,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferSummaryGridRow,
} from '~~/src/scenario'
import { formatGtfsTime, formatServiceDate, type TableColumn, type TableReport } from '~~/src/core'
import { transferSubjectFromKey } from '~/composables/useSubjectTransfers'
import { csvString } from '~/utils/download'
import { useDownload } from '@interline-io/catenary'
import { useToastNotification } from '~/composables/useToastNotification'

// The report's two views.
export type TransferReportView = 'summary' | 'individual'
// A settings panel the toolbar opens.
export type TransferReportSection = TransferSettingsSection | 'stops'

const props = defineProps<{
  // The subject's name, for the downloads' file names.
  title: string
  // The subjects to offer in the picker: clusters and stops.
  subjectOptions: { clusters: { key: string, label: string }[], stops: { key: string, label: string }[] }
  // Set when the picked stops differ from the subject's own: the subject's
  // name.
  customFrom?: string
  // A link to the analysis as shown, to copy.
  shareUrl: () => string
  // The picked stops (the subject's own, as edited), then every stop that can
  // be added, and the routes at them.
  stops: number[]
  mapStops: TransferMapStop[]
  mapRoutes: TransferMapRoute[]
  // The query's area, which bounds the loaded stops.
  extent: GeoJSON.Feature[]
  // Whether stop clustering is off, so only single stops can be picked.
  clusteringOff: boolean
  // Each view's rows, nested: an arriving trip (or destination), then its
  // departing trips.
  summaryGrid: TransferSummaryGridRow[]
  individualGrid: TransferGridRow[]
  // Each view's rows as flat CSV records, built on demand. Only the shown
  // view's grid and chart points are filled.
  csvRows: (kind: 'summary' | 'connections') => Record<string, unknown>[]
  // The date's figures, as both views show them.
  overview: TransferOverview
  individualDates: string[]
  individualDate?: string
  // Whether connections across midnight are cut off, as the departures on
  // the day after the query's last date, or before its first, are not loaded.
  midnightCut?: 'before' | 'after'
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

const emit = defineEmits<{
  // Fetch the details that did not arrive.
  'retry': []
  // Show a route's trips.
  'openTrips': [routeId: number]
  // The stops picked, or the subject's own again.
  'update:stops': [stopIds: number[]]
  // Turn on stop clustering.
  'enableClusters': []
  // The subject's own stops again, its edits dropped.
  'resetStops': []
}>()

// The picked stop or cluster, as "stop:<id>" or "cluster:<id>"; blank for none.
const subject = defineModel<string>('subject', { required: true })
// The picker shows Custom while the stops are not the subject's own; picking
// the subject again, or another, starts from its own stops.
const subjectChoice = computed({
  get: () => (props.customFrom !== undefined ? 'custom' : subject.value),
  set: (v: string) => {
    if (v === subject.value) {
      emit('resetStops')
    } else if (v !== 'custom') {
      subject.value = v
    }
  },
})
const hasSubject = computed(() => !!transferSubjectFromKey(subject.value))
const view = defineModel<TransferReportView>('view', { default: 'summary' })
const date = defineModel<string | undefined>('date')
// The scenario's time of day, shared with the Filter tab, through the URL.
const { startTime, endTime } = useScenarioFilters()
const settings = defineModel<TransferSettings>('settings', { required: true })
// The open settings panel, if any; one opens at a time.
const openSection = defineModel<TransferReportSection | undefined>('section', { required: true })
// Whether a settings panel shows: one is open and a subject is picked.
const panelOpen = computed(() => hasSubject.value && !!openSection.value)
const settingsId = useId()

// The share of trips, arriving and departing, that trip filtering keeps, on
// its button while it keeps less than all of them.
const tripsKept = computed(() => {
  let total = 0
  let kept = 0
  const tally = (routes: TransferRouteChoice[], excluded: string[]) => {
    const out = new Set(excluded)
    for (const d of choiceDestinations(routes)) {
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

const views: { value: TransferReportView, label: string, icon: string }[] = [
  { value: 'summary', label: 'Summary', icon: 'table-large' },
  { value: 'individual', label: 'Individual', icon: 'clock-outline' },
]

function minutes (seconds: number): number {
  return seconds / 60
}

// The columns that share a slot; the grade counts' columns are keyed by
// their grades.
const DURATION_COLUMNS = ['walk_seconds', 'median_wait_seconds']

// A wait's colors by its grade; none for an arrival's own row.
function waitStyle (grade: TransferGridRow['grade'] | undefined) {
  const colors = grade ? TRANSFER_GRADE_COLORS[grade] : undefined
  return colors && { background: colors.fill, color: colors.text }
}

// A faint tint of a grade's color, which keeps text readable in either theme.
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
    { label: 'Connections', value: o.connections.toLocaleString(), tooltip: 'Connections shown, by grade in the bar.' },
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
      // A grade's label, where its segment is wide enough for the label.
      ...TRANSFER_GRADES.map(grade => Plot.text(
        segments.filter(s => s.grade === grade && (s.count / Math.max(1, x)) * width > label(s).length * 9 + 8),
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

const root = ref<HTMLElement>()
const { download: save } = useDownload()
// Narrows the trip filters to a focus, within those already set, and shows
// Individual.
function showInIndividual (f: TransferFocus) {
  settings.value = { ...settings.value, ...focusFilters(f, props.routeChoices, settings.value) }
  view.value = 'individual'
}

// A trip by its route and destination.
function tripName (row: TransferGridTrip): string {
  return `${row.route_name} ${row.headsign}`
}

const { showToast } = useToastNotification()

// A Summary row's link to Individual, with the trips' sign where the
// destination's name differs.
function showTooltip (row: TransferGridTrip): string {
  return row.sign && row.sign !== row.headsign ? `Show in Individual (signed ${row.sign})` : 'Show in Individual'
}

// Shows a Summary row in Individual: a heading row's arrivals or, for a row
// beneath one, only their connections onto its departing destination. The
// trip filters open to show what they keep, and a toast says what changed.
function showRow (row: TransferSummaryGridRow) {
  const head = row.head ? row : props.summaryGrid.find(r => r.id === row.group)!
  const arrivals = `arrivals on ${tripName(head)}`
  showInIndividual(row.head ? { from: [row.group] } : { from: [row.group], to: [row.id.slice(row.group.length + 1)] })
  openSection.value = 'trips'
  showToast(row.head ? `Filtered to ${arrivals}` : `Filtered to ${arrivals} and connections onto ${tripName(row)}`)
  // If the page is scrolled past the report's top, scroll back to the top,
  // where the filters open.
  if ((root.value?.getBoundingClientRect().top ?? 0) < 0) {
    root.value?.scrollIntoView({ block: 'start' })
  }
}

// The downloads, named for the subject and date.
async function download (what: 'link' | 'summary' | 'connections' | 'wait-chart') {
  if (what === 'link') {
    try {
      await navigator.clipboard.writeText(props.shareUrl())
      showToast('Link copied: it opens this analysis, its view, and its settings.')
    } catch {
      showToast('Could not copy the link.', 'danger')
    }
    return
  }
  const name = (kind: string) => `transfers-${kind}-${props.individualDate ?? ''}-${props.title}`
  if (what === 'summary' || what === 'connections') {
    save({ filename: `${name(what === 'summary' ? 'summary' : 'individual')}.csv`, data: csvString(props.csvRows(what)), mimeType: 'text/csv' })
  } else {
    // The bar of connections by grade over the chart, as its legend.
    const svgs = ['.cal-transfer-report-grades svg', '.cal-transfer-report-wait-chart svg']
      .map(selector => root.value?.querySelector<SVGSVGElement>(selector))
      .filter((svg): svg is SVGSVGElement => !!svg)
    if (svgs.length > 0) {
      save({ filename: `${name('wait-chart')}.svg`, data: stackedSvg(svgs), mimeType: 'image/svg+xml' })
    }
  }
}

// Charts one above another as one SVG, at their drawn sizes, on white.
function stackedSvg (svgs: SVGSVGElement[]): string {
  const gap = 12
  const sizes = svgs.map(svg => svg.getBoundingClientRect())
  const width = Math.ceil(Math.max(...sizes.map(r => r.width)))
  const height = Math.ceil(sizes.reduce((h, r) => h + r.height, 0) + gap * (svgs.length - 1))
  const out = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  out.setAttribute('width', String(width))
  out.setAttribute('height', String(height))
  out.setAttribute('viewBox', `0 0 ${width} ${height}`)
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('width', '100%')
  background.setAttribute('height', '100%')
  background.setAttribute('fill', '#ffffff')
  out.append(background)
  let y = 0
  svgs.forEach((svg, i) => {
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('x', '0')
    clone.setAttribute('y', String(y))
    clone.setAttribute('width', String(sizes[i]!.width))
    clone.setAttribute('height', String(sizes[i]!.height))
    out.append(clone)
    y += sizes[i]!.height + gap
  })
  return new XMLSerializer().serializeToString(out)
}

// Each connection's wait by the time its trip arrives. The points and
// breakpoints are read here, not in the returned options, so the chart
// redraws when they change.
const waitChart = computed(() => {
  const points = props.individualPoints
  const bp = props.breakpoints
  return (): Plot.PlotOptions => ({
    height: 180,
    marginTop: 8,
    marginLeft: 64,
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
// the Trip column takes the rest.
const NARROW = { shrink: true }
const COUNT = { shrink: true, align: 'center' as const }

const TRIP_COLUMN: TableColumn = {
  key: 'route_name',
  label: 'Trip',
  sortable: true,
  tooltip: 'Each incoming trip by route and destination, and where it comes from, with the outgoing trips riders connect to beneath it. Sorting orders the incoming trips, and the outgoing trips under each.',
}

// The departures each arrival could take, by how long the wait; and the
// first connection made.
const CONNECTIONS = { key: 'connections', label: 'Connections by wait', tooltip: 'Departures within reach of each arrival, counted by the grade of the wait.' }
const FIRST = { key: 'first', label: 'First connection', tooltip: 'The soonest departure each arrival makes: for an incoming trip, on any route; for an outgoing trip, on it.' }

// A heading row's figures sum up its group, so they show only while the
// group is closed.
const summaryColumns: TableColumn[] = [
  TRIP_COLUMN,
  { key: 'arrivals', label: 'Arrivals', sortable: true, numeric: true, tooltip: 'Trips arriving on this route and destination.', ...NARROW },
  ...TRANSFER_GRADES.map(g => ({ key: g, label: TRANSFER_GRADE_LABELS[g], sortable: true, numeric: true, ...COUNT, group: CONNECTIONS, groupSummary: true })),
  { key: 'close_or_acceptable_share', label: 'Close or acceptable', sortable: true, numeric: true, tooltip: 'Share of arrivals whose first connection is close or acceptable.', group: FIRST, groupSummary: true },
  { key: 'median_wait_seconds', label: 'Median wait', sortable: true, numeric: true, tooltip: 'Median wait for the first connection, over arrivals that make one.', ...NARROW, group: FIRST, groupSummary: true },
]

// The Transfer column group: the walk between stops, then the wait.
const TRANSFER = { key: 'transfer', label: 'Transfer', tooltip: 'From the incoming trip to the outgoing one: the walk between their stops, then the wait.' }
// The Individual table's columns, with the stop where there are several. A
// computed apart from the rows, so the grid keeps its sort as rows change.
const individualColumns = computed((): TableColumn[] => [
  { key: 'time', label: 'Time', sortable: true, tooltip: 'When the trip arrives, or for a departing trip beneath it, leaves.', ...NARROW },
  { ...TRIP_COLUMN, tooltip: 'Each incoming trip, and where it comes from, with its connections beneath it.' },
  ...(props.stops.length > 1 ? [{ key: 'stop_name', label: 'Stop', sortable: true }] : []),
  { key: 'walk_seconds', label: 'Walk', sortable: true, numeric: true, ...NARROW, group: TRANSFER },
  { key: 'wait_seconds', label: 'Wait', sortable: true, numeric: true, tooltip: 'Time between reaching the departing stop and the departure, colored by grade. Negative when missed.', ...NARROW, group: TRANSFER },
])

// The shown view's table; its CSV downloads are in the Share menu.
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
// Controls at their own width, wrapping where the bar is narrow.
.cal-transfer-report-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem;
}

// No space under the view's tabs, which Bulma spaces as a block.
.cal-transfer-report-view {
  --bulma-block-spacing: 0;
}

// The badge sits on its button's corner.
.cal-transfer-report-badge {
  position: absolute;
  top: -0.6rem;
  right: -0.6rem;
}

// An open settings panel, framed below the controls.
.cal-transfer-report-panel {
  margin-top: 1rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
}

.cal-transfer-report-panel-strip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25em;
  width: 100%;
  padding: 0.5em 0;
  border: 0;
  border-top: 1px solid var(--bulma-border);
  border-radius: 0 0 var(--bulma-radius) var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  color: var(--bulma-text-weak);
  font: inherit;
  cursor: pointer;

  &:hover {
    background: var(--bulma-scheme-main-ter);
    color: var(--bulma-text-strong);
  }
}

// The route, then the destination, origin, and tags, which wrap where the
// table is narrow.
.cal-transfer-report-trip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.4em;
  white-space: normal;
}

// Long stop names are cut short, whole on hover, so each row stays one line.
.cal-transfer-report-stop {
  display: inline-block;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

// A grade's count, or a wait, on its grade's color.
.cal-transfer-report-chip {
  display: inline-block;
  min-width: 3em;
  padding: 0 0.4em;
  border-radius: var(--bulma-radius-small);
  text-align: center;
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
</style>
