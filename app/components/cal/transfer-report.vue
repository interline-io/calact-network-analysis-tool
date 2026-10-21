<template>
  <div class="cal-transfer-report">
    <p class="cal-transfer-report-about">
      Each trip arriving here is paired with the trips leaving on other routes
      (or the same route in the other direction) from {{ minutes(bp[0]) }} to
      {{ minutes(bp[4]) }} minutes later, after walking between stops. Waits
      from {{ minutes(bp[1]) }} to {{ minutes(bp[2]) }} minutes are good,
      {{ minutes(bp[2]) }} to {{ minutes(bp[3]) }} OK, and {{ minutes(bp[3]) }}
      to {{ minutes(bp[4]) }} a long wait; a departure up to
      {{ minutes(-bp[0]) }} minutes before the rider can reach it is missed.
    </p>

    <div class="cal-transfer-report-controls">
      <div class="buttons has-addons mb-0">
        <cat-button
          v-for="v of views"
          :key="v.value"
          size="small"
          :variant="view === v.value ? 'primary' : undefined"
          v-bind="{ 'aria-pressed': view === v.value }"
          @click="view = v.value"
        >
          {{ v.label }}
        </cat-button>
      </div>
      <cat-field v-if="view === 'individual' && individualDates.length > 0" label="Date" horizontal>
        <cat-select v-model="date" size="small">
          <option v-for="d of individualDates" :key="d" :value="d">
            {{ formatServiceDate(d) }}
          </option>
        </cat-select>
      </cat-field>
      <cat-field grouped>
        <label class="cal-transfer-report-walk">
          <cat-tooltip text="Time allowed to walk between two different stops. A transfer at the same stop has no walk.">
            Walk between stops (min)
            <cat-icon size="small" icon="information" />
          </cat-tooltip>
          <cat-input
            v-model="walkMinutes"
            :model-modifiers="{ lazy: true }"
            type="number"
            min="0"
            step="0.5"
            size="small"
            v-bind="{ ariaLabel: 'Walk between stops, in minutes' }"
          />
        </label>
      </cat-field>
      <cat-checkbox v-model="allConnections">
        <cat-tooltip text="By default, each arrival shows its first connection on each route and direction, and any it just missed. Check to show every later departure as well.">
          Show every connection
        </cat-tooltip>
      </cat-checkbox>
    </div>

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
      <cal-plot :options="summaryChart" :label="gradeChartLabel(summaryCounts)" />
      <cal-datagrid
        :table-report="summaryReport"
        :loading="detailsLoading"
        caption="Transfers by route"
        :filename="`transfers-summary-${title}`"
      >
        <template #column-from_route_name="{ row }">
          <cal-route-badge :label="row.from_route_name" :color="row.from_route_color" :text-color="row.from_route_text_color" :title="row.from_agency_name" />
        </template>
        <template #column-to_route_name="{ row }">
          <cal-route-badge :label="row.to_route_name" :color="row.to_route_color" :text-color="row.to_route_text_color" :title="row.to_agency_name" />
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
        <div class="cal-transfer-report-charts">
          <cal-plot :options="individualChart" :label="gradeChartLabel(individualCounts)" />
          <cal-plot :options="waitChart" label="Each connection's wait by the time its trip arrives, colored by grade" />
        </div>
        <cal-datagrid
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
            <cal-route-badge :label="row.from_route_name" :color="row.from_route_color" :text-color="row.from_route_text_color" :title="row.from_agency_name" />
          </template>
          <template #column-to_route_name="{ row }">
            <cal-route-badge v-if="row.to_route_name" :label="row.to_route_name" :color="row.to_route_color" :text-color="row.to_route_text_color" :title="row.to_agency_name" />
          </template>
          <template #column-walk_seconds="{ value }">
            <span class="cal-transfer-report-time">{{ value === '' ? '' : formatWait(value) }}</span>
          </template>
          <template #column-wait_seconds="{ row }">
            <span
              v-if="row.wait_seconds !== ''"
              class="cal-transfer-report-wait"
              :style="gradeStyle(row.grade)"
              :title="row.grade"
            >{{ formatWait(row.wait_seconds) }}</span>
          </template>
        </cal-datagrid>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import * as Plot from '@observablehq/plot'
import {
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  formatWait,
  tripTimeLabel,
  type TransferGrade,
  type TransferGradeCount,
  type TransferRow,
  type TransferSummaryRow,
} from '~~/src/scenario'
import { TRANSFER_GRADE_BREAKPOINTS, formatServiceDate, type TableColumn, type TableReport } from '~~/src/core'

export type TransferReportView = 'summary' | 'individual'

const props = defineProps<{
  // What the transfers are at, as the downloads' file names.
  title: string
  subjectKind: 'stop' | 'cluster'
  summaryRows: TransferSummaryRow[]
  summaryCounts: TransferGradeCount[]
  individualDates: string[]
  individualDate?: string
  individualRows: TransferRow[]
  individualCounts: TransferGradeCount[]
  individualPoints: { hour: number, waitMinutes: number, grade: TransferGrade }[]
  missingDetails: number
  detailsLoading: boolean
  detailsError: string | null
}>()

defineEmits<{
  // Fetch the details that did not arrive.
  retry: []
}>()

const view = defineModel<TransferReportView>('view', { default: 'summary' })
const date = defineModel<string | undefined>('date')
const walkMinutes = defineModel<number>('walkMinutes', { required: true })
const allConnections = defineModel<boolean>('allConnections', { required: true })

const views: { value: TransferReportView, label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'individual', label: 'Individual' },
]

const bp = TRANSFER_GRADE_BREAKPOINTS
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

// Connections by grade, in order of wait.
function gradeChart (counts: TransferGradeCount[]) {
  return (_width: number): Plot.PlotOptions => ({
    height: 200,
    marginTop: 24,
    x: { label: null, domain: counts.map(c => c.label) },
    y: { label: 'Connections', grid: true },
    color: gradeColor,
    marks: [
      Plot.barY(counts, { x: 'label', y: 'count', fill: 'grade' }),
      Plot.text(counts, { x: 'label', y: 'count', text: (d: TransferGradeCount) => `${d.count.toLocaleString()} (${percent(d.share)})`, dy: -8 }),
      Plot.ruleY([0]),
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
  height: 200,
  x: { label: 'Arrival', tickFormat: hourLabel },
  y: { label: 'Wait (min)', grid: true, domain: [minutes(bp[0]), minutes(bp[4])] },
  color: { ...gradeColor, legend: true, tickFormat: (g: TransferGrade) => TRANSFER_GRADE_LABELS[g] },
  marks: [
    Plot.ruleY([0], { strokeOpacity: 0.5 }),
    Plot.dot(props.individualPoints, { x: 'hour', y: 'waitMinutes', fill: 'grade', r: 2.5 }),
  ],
}))

const summaryColumns: TableColumn[] = [
  { key: 'from_route_name', label: 'From route', sortable: true },
  { key: 'from_headsign', label: 'From headsign', sortable: true },
  { key: 'to_route_name', label: 'To route', sortable: true },
  { key: 'to_headsign', label: 'To headsign', sortable: true },
  { key: 'arrivals', label: 'Arrivals', sortable: true, numeric: true, tooltip: 'Trips arriving on the From route and direction.' },
  { key: 'missed', label: 'Missed', sortable: true, numeric: true },
  { key: 'good', label: 'Good', sortable: true, numeric: true },
  { key: 'ok', label: 'OK', sortable: true, numeric: true },
  { key: 'long_wait', label: 'Long wait', sortable: true, numeric: true },
  { key: 'good_or_ok_share', label: 'Good or OK', sortable: true, numeric: true, tooltip: 'Share of arrivals whose first connection to the To route and direction is good or OK.' },
  { key: 'median_wait', label: 'Median wait', sortable: true, tooltip: 'Median wait for the first connection, over arrivals that make one (minutes:seconds).' },
]

const summaryReport = computed((): TableReport => ({
  columns: summaryColumns,
  data: props.summaryRows,
}))

const individualReport = computed((): TableReport => {
  const cluster = props.subjectKind === 'cluster'
  const columns: TableColumn[] = [
    { key: 'arrival_time', label: 'Arrival', sortable: true },
    { key: 'from_route_name', label: 'From route', sortable: true },
    { key: 'from_headsign', label: 'From headsign', sortable: true },
    ...(cluster ? [{ key: 'from_stop_name', label: 'Arrives at', sortable: true }] : []),
    { key: 'departure_time', label: 'Departure', sortable: true },
    { key: 'to_route_name', label: 'To route', sortable: true },
    { key: 'to_headsign', label: 'To headsign', sortable: true },
    ...(cluster ? [{ key: 'to_stop_name', label: 'Departs from', sortable: true }] : []),
    { key: 'walk_seconds', label: 'Walk', sortable: true, numeric: true },
    { key: 'wait_seconds', label: 'Wait', sortable: true, numeric: true, tooltip: 'Time between reaching the departing stop and the departure (minutes:seconds), colored by grade. Negative when missed.' },
    { key: 'grade', label: 'Grade', sortable: true },
  ]
  return { columns, data: props.individualRows }
})
</script>

<style scoped lang="scss">
.cal-transfer-report-about {
  font-size: 0.875rem;
  color: var(--bulma-text-weak);
  margin-bottom: 0.75rem;
}

.cal-transfer-report-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1.25rem;
  margin-bottom: 1rem;

  :deep(.field) {
    margin-bottom: 0;
  }
}

.cal-transfer-report-walk {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;

  :deep(input) {
    width: 5rem;
  }
}

.cal-transfer-report-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
  gap: 1rem;
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
