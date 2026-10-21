<template>
  <div class="cal-transfer-report">
    <!-- What the report is about and how it is viewed come first; the
         settings that tune walking and grading open below on request. -->
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
      <template v-if="subjectKind">
        <!-- Two views of the same transfers, as a toggle of tabs. -->
        <cat-field label="View" class="cal-transfer-report-view">
          <cat-tabs v-model="view" type="toggle">
            <cat-tab-item v-for="v of views" :key="v.value" :value="v.value" :label="v.label" />
          </cat-tabs>
        </cat-field>
        <!-- Which arrivals to show: the Summary covers every date unless one
             is picked; Individual shows one date at a time. -->
        <cat-field v-if="individualDates.length > 0" label="Date">
          <cat-select
            :model-value="view === 'summary' ? (summaryDate ?? '') : individualDate"
            @update:model-value="date = $event || undefined"
          >
            <option v-if="view === 'summary'" value="">
              All dates
            </option>
            <option v-for="d of individualDates" :key="d" :value="d">
              {{ formatServiceDate(d) }}
            </option>
          </cat-select>
        </cat-field>
        <cat-field label="Time of day">
          <cat-select v-model="timeBand">
            <option v-for="b of TRANSFER_TIME_BANDS" :key="b.key" :value="b.key">
              {{ b.label }}
            </option>
          </cat-select>
        </cat-field>
        <!-- Each opens its settings below the toolbar, one at a time. -->
        <cat-field label="Settings" class="cal-transfer-report-settings-field">
          <div class="cal-transfer-report-settings-toggles">
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
              <!-- A count on the button's corner, so it shows at a glance
                   that trips are left out, without widening the button; said
                   in full on hover and to screen readers. -->
              <span v-if="t.badge" class="cal-transfer-report-badge" :title="t.badge.title">
                <span aria-hidden="true">{{ t.badge.short }}</span>
                <span class="is-sr-only">{{ t.badge.title }}</span>
              </span>
            </cat-button>
          </div>
        </cat-field>
      </template>
    </div>

    <!-- The table's CSV, beside the page's other downloads. -->
    <Teleport v-if="subjectKind" defer to="#cal-report-tab-downloads">
      <cal-csv-download
        :data="view === 'summary' ? summaryRows : individualRows"
        :disabled="detailsLoading"
        :filename="view === 'summary' ? `transfers-summary-${title}` : `transfers-${individualDate}-${title}`"
        :button-text="view === 'summary' ? 'Download summary as CSV' : 'Download transfers as CSV'"
      />
    </Teleport>

    <cal-transfer-settings
      v-if="subjectKind && openSection"
      v-bind="{ id: settingsId }"
      v-model="settings"
      :section="openSection"
      :route-choices="routeChoices"
      :unknown-pairs="unknownPairs"
    />

    <p v-if="!subjectKind" class="cal-transfer-report-note">
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
      <p v-else-if="detailsLoading || missingDetails > 0" class="cal-transfer-report-note">
        Loading trip details{{ missingDetails > 0 ? `: ${missingDetails.toLocaleString()} trips to go` : '' }}…
      </p>

      <template v-if="view === 'summary'">
        <div class="cal-transfer-report-overview">
          <dl class="cal-transfer-report-figures">
            <div v-for="f of figures(summaryOverview)" :key="f.label">
              <dt>
                <cat-tooltip v-if="f.tooltip" :text="f.tooltip">
                  {{ f.label }}
                </cat-tooltip>
                <template v-else>
                  {{ f.label }}
                </template>
              </dt>
              <dd>{{ f.value }}</dd>
            </div>
          </dl>
          <cal-plot class="cal-transfer-report-grades" :options="summaryChart" :label="gradeChartLabel(summaryCounts)" />
        </div>
        <cal-datagrid
          fill
          dense
          :searchable="false"
          :downloadable="false"
          :per-page="100"
          :table-report="summaryReport"
          :loading="detailsLoading"
          caption="Transfers by route"
          :filename="`transfers-summary-${title}`"
        >
          <template #column-from_route_name="{ row }">
            <cal-route-badge :label="row.from_route_name" :title="row.from_agency_name" />
            <span class="cal-transfer-report-headsign cal-transfer-report-clip" :title="row.from_headsign">{{ row.from_headsign }}</span>
          </template>
          <template #column-to_route_name="{ row }">
            <cal-route-badge :label="row.to_route_name" :title="row.to_agency_name" />
            <span class="cal-transfer-report-headsign cal-transfer-report-clip" :title="row.to_headsign">{{ row.to_headsign }}</span>
          </template>
          <template #column-good_or_ok_share="{ value }">
            {{ value }}%
          </template>
        </cal-datagrid>
      </template>

      <template v-else>
        <p v-if="individualDates.length === 0" class="cal-transfer-report-note">
          No trips arrive here within the filters.
        </p>
        <template v-else>
          <div class="cal-transfer-report-overview">
            <dl class="cal-transfer-report-figures">
              <div v-for="f of figures(individualOverview)" :key="f.label">
                <dt>
                  <cat-tooltip v-if="f.tooltip" :text="f.tooltip">
                    {{ f.label }}
                  </cat-tooltip>
                  <template v-else>
                    {{ f.label }}
                  </template>
                </dt>
                <dd>{{ f.value }}</dd>
              </div>
            </dl>
            <cal-plot class="cal-transfer-report-grades" :options="individualChart" :label="gradeChartLabel(individualCounts)" />
          </div>
          <cal-plot :options="waitChart" label="Each connection's wait by the time its trip arrives, colored by grade" />
          <cal-datagrid
            fill
            dense
            :searchable="false"
            :downloadable="false"
            :per-page="100"
            :table-report="individualReport"
            :loading="detailsLoading"
            caption="Transfers"
            :filename="`transfers-${individualDate}-${title}`"
            :row-class="row => row.grade === 'No connection' ? 'cal-transfer-report-none' : undefined"
          >
            <template #column-arrival_time="{ value }">
              <span class="cal-transfer-report-time">{{ tripTimeLabel(value) }}</span>
            </template>
            <template #column-departure_time="{ value }">
              <span class="cal-transfer-report-time">{{ tripTimeLabel(value) }}</span>
            </template>
            <template #column-from_route_name="{ row }">
              <cal-route-badge :label="row.from_route_name" :title="row.from_agency_name" />
              <span class="cal-transfer-report-headsign cal-transfer-report-clip" :title="row.from_headsign">{{ row.from_headsign }}</span>
            </template>
            <template #column-to_route_name="{ row }">
              <template v-if="row.to_route_name">
                <cal-route-badge :label="row.to_route_name" :title="row.to_agency_name" />
                <span class="cal-transfer-report-headsign cal-transfer-report-clip" :title="row.to_headsign">{{ row.to_headsign }}</span>
              </template>
            </template>
            <template #column-walk_seconds="{ value }">
              <span class="cal-transfer-report-time">{{ value === '' ? '' : formatWait(value) }}</span>
            </template>
            <template #column-from_stop_name="{ value }">
              <span class="cal-transfer-report-clip cal-transfer-report-stop" :title="value">{{ value }}</span>
            </template>
            <template #column-to_stop_name="{ value }">
              <span class="cal-transfer-report-clip cal-transfer-report-stop" :title="value">{{ value }}</span>
            </template>
            <!-- The grade is the wait's color, and text for screen readers. -->
            <template #column-wait_seconds="{ row }">
              <span
                v-if="row.wait_seconds !== ''"
                class="cal-transfer-report-wait"
                :style="gradeStyle(row.grade)"
                :title="row.grade"
              >{{ formatWait(row.wait_seconds) }}<span class="is-sr-only">, {{ row.grade }}</span></span>
              <span v-else>{{ row.grade }}</span>
            </template>
          </cal-datagrid>
        </template>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import type { TransferSettingsSection } from './transfer-settings.vue'
import * as Plot from '@observablehq/plot'
import {
  TRANSFER_TIME_BANDS,
  type TransferOverview,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  formatWait,
  tripTimeLabel,
  type TransferGrade,
  type TransferGradeCount,
  type TransferRow,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferSummaryRow,
  type TransferTimeBand,
} from '~~/src/scenario'
import { formatServiceDate, type TableColumn, type TableReport } from '~~/src/core'

export type TransferReportView = 'summary' | 'individual'

const props = defineProps<{
  // What the transfers are at, as the downloads' file names.
  title: string
  // The stops and clusters the report can be about, as picker options.
  subjectOptions: { clusters: { key: string, label: string }[], stops: { key: string, label: string }[] }
  summaryRows: TransferSummaryRow[]
  summaryCounts: TransferGradeCount[]
  summaryOverview: TransferOverview
  individualDates: string[]
  individualDate?: string
  // The date the Summary is narrowed to; every date when undefined.
  summaryDate?: string
  individualRows: TransferRow[]
  individualCounts: TransferGradeCount[]
  individualOverview: TransferOverview
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
  retry: []
}>()

// The picked stop or cluster, as "stop:<id>" or "cluster:<id>"; blank for none.
const subject = defineModel<string>('subject', { required: true })
const subjectKind = computed(() => (subject.value.startsWith('cluster:') ? 'cluster' : subject.value.startsWith('stop:') ? 'stop' : undefined))
const view = defineModel<TransferReportView>('view', { default: 'summary' })
const date = defineModel<string | undefined>('date')
const timeBand = defineModel<TransferTimeBand>('timeBand', { required: true })
const settings = defineModel<TransferSettings>('settings', { required: true })
const openSection = ref<TransferSettingsSection>()
const settingsId = useId()

// How many trips trip filtering leaves out, arriving and departing, on its
// button.
const excludedCount = computed(() => {
  const count = (routes: TransferRouteChoice[], excluded: string[]) => {
    const out = new Set(excluded)
    return routes.flatMap(r => r.directions.flatMap(d => d.destinations)).filter(d => out.has(d.key)).reduce((n, d) => n + d.count, 0)
  }
  return count(props.routeChoices.from, settings.value.excludedFrom) + count(props.routeChoices.to, settings.value.excludedTo)
})
const settingsToggles = computed((): { section: TransferSettingsSection, label: string, icon: string, badge?: { short: string, title: string } }[] => [
  { section: 'wait-walk', label: 'Wait & walking', icon: 'tune' },
  { section: 'trips', label: 'Trip filtering', icon: 'filter-variant', badge: excludedCount.value > 0 ? { short: excludedCount.value > 999 ? '999+' : String(excludedCount.value), title: `${excludedCount.value.toLocaleString()} trips excluded` } : undefined },
])

const views: { value: TransferReportView, label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'individual', label: 'Individual' },
]

function minutes (seconds: number): number {
  return seconds / 60
}

const gradeByLabel = new Map(TRANSFER_GRADES.map(g => [TRANSFER_GRADE_LABELS[g], g]))
function gradeStyle (label: string) {
  const grade = gradeByLabel.get(label)
  return grade ? { background: TRANSFER_GRADE_COLORS[grade].fill, color: TRANSFER_GRADE_COLORS[grade].text } : undefined
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
    { label: 'Good or OK', value: percent(o.goodOrOkShare), tooltip: 'Share of arrivals whose soonest connection, on any route, is good or OK.' },
    { label: 'Median wait', value: formatWait(o.medianWait) || '—', tooltip: 'Median wait for each arrival\'s soonest connection, over arrivals that make one (minutes:seconds).' },
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
  const label = (d: TransferGradeCount) => `${d.label} ${d.count.toLocaleString()} (${percent(d.share)})`
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

// Built once per change of counts, so a chart redraws only when they change.
const summaryChart = computed(() => gradeChart(props.summaryCounts))
const individualChart = computed(() => gradeChart(props.individualCounts))

function gradeChartLabel (counts: TransferGradeCount[]): string {
  return `Connections by grade: ${counts.map(c => `${c.label} ${c.count} (${percent(c.share)})`).join(', ')}`
}

function hourLabel (hour: number): string {
  return `${String(Math.floor(hour)).padStart(2, '0')}:00`
}

// Each connection's wait by the time its trip arrives.
const waitChart = computed(() => (_width: number): Plot.PlotOptions => ({
  height: 120,
  marginTop: 8,
  marginLeft: 56,
  x: { label: null, tickFormat: hourLabel },
  // The grade bar above is the legend.
  y: { label: null, grid: true, ticks: props.breakpoints.map(minutes), tickFormat: (m: number) => `${m} min`, domain: [minutes(props.breakpoints[0]!), minutes(props.breakpoints[4]!)] },
  color: gradeColor,
  marks: [
    Plot.ruleY([0], { strokeOpacity: 0.5 }),
    Plot.dot(props.individualPoints, { x: 'hour', y: 'waitMinutes', fill: 'grade', r: 2.5 }),
  ],
}))

const summaryColumns: TableColumn[] = [
  { key: 'from_route_name', label: 'From', sortable: true, tooltip: 'The arriving route, and its headsign.' },
  { key: 'to_route_name', label: 'To', sortable: true, tooltip: 'The departing route, and its headsign.' },
  { key: 'arrivals', label: 'Arrivals', sortable: true, numeric: true, tooltip: 'Trips arriving on the From route and direction.' },
  { key: 'missed', label: 'Missed', sortable: true, numeric: true, headerStyle: gradeStyle('Missed') },
  { key: 'good', label: 'Good', sortable: true, numeric: true, headerStyle: gradeStyle('Good') },
  { key: 'ok', label: 'OK', sortable: true, numeric: true, headerStyle: gradeStyle('OK') },
  { key: 'long_wait', label: 'Long wait', sortable: true, numeric: true, headerStyle: gradeStyle('Long wait') },
  { key: 'good_or_ok_share', label: 'Good or OK', sortable: true, numeric: true, tooltip: 'Share of arrivals whose first connection to the To route and direction is good or OK.' },
  { key: 'median_wait', label: 'Median wait', sortable: true, tooltip: 'Median wait for the first connection, over arrivals that make one (minutes:seconds).' },
]

const summaryReport = computed((): TableReport => ({
  columns: summaryColumns,
  data: props.summaryRows,
}))

const individualReport = computed((): TableReport => {
  const cluster = subjectKind.value === 'cluster'
  const columns: TableColumn[] = [
    { key: 'arrival_time', label: 'Arrival', sortable: true },
    { key: 'from_route_name', label: 'From', sortable: true, tooltip: 'The arriving route, and its headsign.' },
    ...(cluster ? [{ key: 'from_stop_name', label: 'Arrives at', sortable: true }] : []),
    { key: 'departure_time', label: 'Departure', sortable: true },
    { key: 'to_route_name', label: 'To', sortable: true, tooltip: 'The departing route, and its headsign.' },
    ...(cluster ? [{ key: 'to_stop_name', label: 'Departs from', sortable: true }] : []),
    { key: 'walk_seconds', label: 'Walk', sortable: true, numeric: true },
    { key: 'wait_seconds', label: 'Wait', sortable: true, numeric: true, tooltip: 'Time between reaching the departing stop and the departure (minutes:seconds), colored by grade. Negative when missed.' },
  ]
  return { columns, data: props.individualRows }
})
</script>

<style scoped lang="scss">
// Fills the Reports tab's height: the controls and charts at their own
// height, and the table the rest, scrolling inside.
.cal-transfer-report {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.cal-transfer-report-subject :deep(select) {
  // Not as wide as its longest option, so the toolbar keeps to one line.
  width: 16rem;
}

// The primary fields, labeled, at full size; the settings toggle at the end
// of the row.
.cal-transfer-report-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.5rem 1rem;
  margin-bottom: 0.75rem;
  flex: 0 0 auto;

  :deep(.field) {
    margin-bottom: 0;
  }

  :deep(.label) {
    margin-bottom: 0.25rem;
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
  top: -0.55rem;
  right: -0.55rem;
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bulma-primary);
  color: var(--bulma-primary-invert, #fff);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
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

.cal-transfer-report-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;

  :deep(input) {
    width: 5rem;
  }
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

.cal-transfer-report-headsign {
  margin-left: 0.4em;
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

.cal-transfer-report-wait {
  display: inline-block;
  min-width: 3.5em;
  padding: 0 0.4em;
  border-radius: 4px;
  text-align: center;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

// The row is in the datagrid, outside this component's scope.
:deep(.cal-transfer-report-none) td {
  color: var(--bulma-text-weak);
}
</style>
