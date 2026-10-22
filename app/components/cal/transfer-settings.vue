<template>
  <section
    class="cal-transfer-settings"
    :class="section === 'trips' ? 'cal-transfer-settings-trips' : 'cal-transfer-settings-wait-walk'"
    :aria-label="section === 'trips' ? 'Trip filtering' : 'Wait and walking settings'"
  >
    <div v-if="section === 'wait-walk'" class="cal-transfer-settings-wait-walk-grid">
      <cat-fieldset label="Walking between stops" class="cal-transfer-settings-walk">
        <div class="cal-transfer-settings-row">
          <cat-radio
            v-for="o of walkOptions"
            :key="o.value"
            :model-value="settings.walkDistance"
            :native-value="o.value"
            :disabled="o.disabled"
            @update:model-value="set({ walkDistance: $event as TransferSettings['walkDistance'] })"
          >
            <cat-tooltip :text="o.tooltip">
              {{ o.label }}
            </cat-tooltip>
          </cat-radio>
        </div>
        <label class="cal-transfer-settings-row">
          Seconds per meter
          <cat-input
            :model-value="settings.secondsPerMeter"
            :model-modifiers="{ lazy: true }"
            type="number"
            min="0.1"
            step="0.1"
            size="small"
            class="cal-transfer-settings-number"
            v-bind="{ ariaLabel: 'Walking seconds per meter' }"
            @update:model-value="set({ secondsPerMeter: Number($event) })"
          />
          <span class="cal-transfer-settings-help">{{ pace }}; no walk at the same stop</span>
        </label>
        <p v-if="unknownPairs > 0" class="cal-transfer-settings-warning">
          No distance for {{ unknownPairs }} {{ unknownPairs === 1 ? 'pair' : 'pairs' }} of stops; transfers between them are left out.
        </p>
      </cat-fieldset>

      <!-- The grades as a bar across the wait, as Transfer Analyst draws it:
           each grade in its color, with its range, the waits that bound them
           between, and beyond the ends, waits that are not transfers. -->
      <cat-fieldset label="Grades (minutes of wait)" class="cal-transfer-settings-grades">
        <div class="cal-transfer-settings-scale">
          <span class="cal-transfer-settings-band cal-transfer-settings-band-none">Not a transfer</span>
          <template v-for="(bound, i) of bounds" :key="bound">
            <cat-input
              :model-value="minutes(settings.breakpoints[i])"
              :model-modifiers="{ lazy: true }"
              type="number"
              step="0.5"
              size="small"
              class="cal-transfer-settings-number"
              v-bind="{ ariaLabel: `${bound}, in minutes` }"
              @update:model-value="setBreakpoint(i, Number($event))"
            />
            <span
              v-if="TRANSFER_GRADES[i]"
              class="cal-transfer-settings-band"
              :style="{ background: TRANSFER_GRADE_COLORS[TRANSFER_GRADES[i]!].fill, color: TRANSFER_GRADE_COLORS[TRANSFER_GRADES[i]!].text }"
            >
              <strong>{{ TRANSFER_GRADE_LABELS[TRANSFER_GRADES[i]!] }}</strong>
              <span>{{ range(i) }}</span>
            </span>
          </template>
          <span class="cal-transfer-settings-band cal-transfer-settings-band-none">Not a transfer</span>
        </div>
        <p class="cal-transfer-settings-help">
          <span v-if="!breakpointsValid" class="cal-transfer-settings-warning">Each must be more than the one before; the defaults apply until then.</span>
          <button type="button" class="cal-transfer-settings-link" @click="set({ breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] })">
            Reset
          </button>
        </p>
      </cat-fieldset>

      <cat-fieldset label="Connections" class="cal-transfer-settings-connections">
        <div class="cal-transfer-settings-options">
          <div>
            <cat-checkbox :model-value="settings.allConnections" @update:model-value="set({ allConnections: !!$event })">
              Show every connection
            </cat-checkbox>
            <p class="cal-transfer-settings-help">
              Otherwise each arrival shows its first connection to each route,
              direction, and destination, and any it missed before then.
            </p>
          </div>
          <div>
            <cat-checkbox :model-value="settings.countTurnbacks" @update:model-value="set({ countTurnbacks: !!$event })">
              Count likely turnbacks
            </cat-checkbox>
            <p class="cal-transfer-settings-help">
              A trip ending here and one of the same agency starting from the
              same stop are likely one vehicle turning back, so are not counted
              as a transfer unless checked.
            </p>
          </div>
        </div>
      </cat-fieldset>
    </div>

    <!-- Arriving and departing trips side by side, as www groups a stop's
         departures: each route, its directions ("Toward X"), and their
         destinations, opened on request, with trip counts. -->
    <template v-else>
      <div v-for="side of sides" :key="side.key" class="cal-transfer-settings-side" role="group" :aria-label="`${side.legend} trips`">
        <div class="cal-transfer-settings-side-head">
          <span>{{ side.legend }} trips</span>
          <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: [] })">
            All
          </button>
          <button type="button" class="cal-transfer-settings-link" @click="set({ [side.key]: [...new Set(side.rows.flatMap(r => r.keys))] })">
            None
          </button>
        </div>
        <ul class="cal-transfer-settings-list">
          <li
            v-for="row of side.rows"
            :key="row.id"
            class="cal-transfer-settings-item"
            :class="row.operator ? 'cal-transfer-settings-operator' : [`cal-transfer-settings-depth-${row.depth}`, { 'cal-transfer-settings-sub': !row.badge }]"
          >
            <!-- An operator's routes show unless closed; a direction's
                 destinations, once opened. -->
            <button
              v-if="row.collapseKey"
              type="button"
              class="cal-transfer-settings-caret"
              :aria-expanded="!collapsed.has(row.collapseKey)"
              :aria-label="`${collapsed.has(row.collapseKey) ? 'Show' : 'Hide'} routes of ${row.label}`"
              @click="toggleCollapsed(row.collapseKey)"
            >
              <cat-icon size="small" :icon="collapsed.has(row.collapseKey) ? 'chevron-right' : 'chevron-down'" />
            </button>
            <button
              v-else-if="row.openKey"
              type="button"
              class="cal-transfer-settings-caret"
              :aria-expanded="opened.has(row.openKey)"
              :aria-label="`${opened.has(row.openKey) ? 'Hide' : 'Show'} destinations for ${row.label}`"
              @click="toggleOpen(row.openKey)"
            >
              <cat-icon size="small" :icon="opened.has(row.openKey) ? 'chevron-down' : 'chevron-right'" />
            </button>
            <span v-else class="cal-transfer-settings-caret" />
            <cat-checkbox
              class="cal-transfer-settings-item-check"
              :model-value="row.state !== 'none'"
              :indeterminate="row.state === 'some'"
              @update:model-value="setKeys(side.key, row.keys, !!$event)"
            >
              <cal-route-badge v-if="row.badge" :label="row.badge" :title="row.title" />
              <span class="cal-transfer-settings-item-label" :title="row.title">{{ row.label }}</span>
              <span v-if="row.origin" class="cal-transfer-settings-origin" :title="`From ${row.origin}`">from {{ row.origin }}</span>
              <span v-for="tag of row.tags" :key="tag.label" class="tag is-light cal-transfer-settings-tag" :title="tag.title">
                {{ tag.label }}<span class="is-sr-only">: {{ tag.title }}</span>
              </span>
            </cat-checkbox>
            <button
              v-if="row.routeId !== undefined"
              type="button"
              class="cal-transfer-settings-view-trips"
              :title="`View trips for route ${row.badge}`"
              :aria-label="`View trips for route ${row.badge}`"
              @click="emit('openTrips', row.routeId)"
            >
              <cat-icon size="small" icon="table-clock" />
            </button>
            <span class="cal-transfer-settings-count">{{ row.count.toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  DEFAULT_TRANSFER_SETTINGS,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  validBreakpoints,
  transferTripTags,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferTripDestination,
  type TransferTripTag,
} from '~~/src/scenario'

export type TransferSettingsSection = 'wait-walk' | 'trips'

const props = defineProps<{
  // Which settings to show: waits and walking, or the trips to include.
  section: TransferSettingsSection
  // The routes arriving and departing at the stops.
  routeChoices: { from: TransferRouteChoice[], to: TransferRouteChoice[] }
  // Pairs of the stops with no distance between them.
  unknownPairs: number
}>()

const settings = defineModel<TransferSettings>({ required: true })

const emit = defineEmits<{
  // Show a route's trips.
  openTrips: [routeId: number]
}>()

function set (change: Partial<TransferSettings>) {
  settings.value = { ...settings.value, ...change }
}

const walkOptions: { value: TransferSettings['walkDistance'], label: string, tooltip: string, disabled?: boolean }[] = [
  { value: 'line', label: 'Straight line', tooltip: 'The straight-line distance between the stops.' },
  { value: 'street', label: 'Street network', tooltip: 'The distance along streets and paths, from OpenStreetMap; a straight line where no route is found.' },
  { value: 'pathways', label: 'GTFS-Pathways', tooltip: 'Coming later: walks through stations along the paths, stairs, and elevators their feeds publish.', disabled: true },
]

// 1 second per meter is 3.6 km/h.
const pace = computed(() => {
  const spm = settings.value.secondsPerMeter
  if (!(spm > 0)) {
    return 'no walk'
  }
  const kmh = 3.6 / spm
  return `${kmh.toFixed(1)} km/h (${(kmh / 1.609344).toFixed(1)} mph)`
})

// The five breakpoints, by what each starts or ends, and the grades between.
const bounds = [...TRANSFER_GRADES.map(g => `${TRANSFER_GRADE_LABELS[g]} from`), `${TRANSFER_GRADE_LABELS.unacceptable} up to`]

// A grade's range, between the breakpoints either side of it: "-5 to 0 min".
function range (i: number): string {
  const [from, to] = [minutes(settings.value.breakpoints[i]), minutes(settings.value.breakpoints[i + 1])]
  return `${from ?? ''} to ${to ?? ''} min`
}

function minutes (seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds / 60
}

function setBreakpoint (index: number, mins: number) {
  const breakpoints = [...settings.value.breakpoints]
  breakpoints[index] = mins * 60
  set({ breakpoints })
}

const breakpointsValid = computed(() => validBreakpoints(settings.value.breakpoints))

type Side = 'excludedFrom' | 'excludedTo'

// One line of a side's list: a route, a direction, or a destination, with
// the destination keys its checkbox covers.
interface Row {
  id: string
  depth: number
  badge?: string
  label: string
  title?: string
  count: number
  keys: string[]
  // For one destination: where an arriving one comes from, and its tags.
  origin?: string
  tags: TransferTripTag[]
  // On a route's first row, the route, to show its trips.
  routeId?: number
  // An operator's row, over its routes; and the key that closes it.
  operator?: boolean
  collapseKey?: string
  // Whether all, some, or none of the keys are included.
  state: 'all' | 'some' | 'none'
  // Set where the row opens to destinations.
  openKey?: string
}

// Operators closed to hide their routes; all open to begin with.
const collapsed = ref(new Set<string>())
function toggleCollapsed (key: string) {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  collapsed.value = next
}

// Rows opened to show their destinations.
const opened = ref(new Set<string>())
function toggleOpen (key: string) {
  const next = new Set(opened.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  opened.value = next
}

// Where the routes come from more than one operator, each operator's routes
// under a row for it, operators by name; otherwise the routes alone.
function rows (side: Side, routes: TransferRouteChoice[]): Omit<Row, 'state'>[] {
  const byOperator = new Map<string, TransferRouteChoice[]>()
  for (const route of routes) {
    byOperator.set(route.operator, [...(byOperator.get(route.operator) ?? []), route])
  }
  if (byOperator.size < 2) {
    return routeRows(side, routes)
  }
  return [...byOperator]
    .sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1))
    .flatMap(([operator, list]) => {
      const collapseKey = `${side}|${operator}`
      return [
        {
          id: `o${operator}`,
          depth: 0,
          label: operator || 'Unknown operator',
          count: list.reduce((n, r) => n + r.count, 0),
          keys: list.flatMap(r => r.directions.flatMap(d => d.destinations.map(x => x.key))),
          tags: [],
          operator: true,
          collapseKey,
        },
        // A level in from the operator.
        ...(collapsed.value.has(collapseKey) ? [] : routeRows(side, list, 1)),
      ]
    })
}

// A route with one direction at the stops is one row; with two, a row and a
// row per direction. A direction with several destinations opens to them.
function routeRows (side: Side, routes: TransferRouteChoice[], base = 0): Omit<Row, 'state'>[] {
  const out: Omit<Row, 'state'>[] = []
  const tripSide = side === 'excludedFrom' ? 'from' : 'to'
  const about = (d: TransferTripDestination | undefined) => ({
    // Named "From" its origin, a destination needs no origin beside.
    origin: tripSide === 'from' && !d?.label.startsWith('From ') ? d?.run.origin : undefined,
    tags: transferTripTags(d, tripSide),
  })
  for (const route of routes) {
    const single = route.directions.length === 1
    const routeKeys = route.directions.flatMap(d => d.destinations.map(x => x.key))
    const title = route.longName || route.label
    for (const [i, dir] of route.directions.entries()) {
      const depth = base + (single ? 0 : 1)
      const openKey = dir.destinations.length > 1 ? `${side}|${route.id}|${dir.directionId}` : undefined
      if (i === 0 && !single) {
        // The long name beside the badge, where it says more than the badge.
        const label = route.longName !== route.label ? route.longName : ''
        out.push({ id: `r${route.id}`, depth: base, badge: route.label, label, title, count: route.count, keys: routeKeys, tags: [], routeId: route.id })
      }
      out.push({
        id: `d${route.id}|${dir.directionId}`,
        depth,
        badge: single ? route.label : undefined,
        label: dir.label,
        title,
        count: dir.count,
        keys: dir.destinations.map(x => x.key),
        openKey,
        ...(dir.destinations.length === 1 ? about(dir.destinations[0]) : { tags: [] }),
        routeId: single ? route.id : undefined,
      })
      if (openKey && opened.value.has(openKey)) {
        for (const dest of dir.destinations) {
          out.push({ id: `x${dest.key}`, depth: depth + 1, label: dest.label, count: dest.count, keys: [dest.key], ...about(dest) })
        }
      }
    }
  }
  return out
}

// Each side's rows, with their checkbox state read from one set of the
// side's exclusions.
const sides = computed(() => [
  { key: 'excludedFrom' as const, legend: 'Arriving', routes: props.routeChoices.from },
  { key: 'excludedTo' as const, legend: 'Departing', routes: props.routeChoices.to },
].map((side) => {
  const excluded = new Set(settings.value[side.key])
  const rowsWithState = rows(side.key, side.routes).map((row) => {
    const out = row.keys.filter(k => excluded.has(k)).length
    return { ...row, state: out === 0 ? 'all' as const : out === row.keys.length ? 'none' as const : 'some' as const }
  })
  return { key: side.key, legend: side.legend, rows: rowsWithState }
}))

function setKeys (side: Side, keys: string[], included: boolean) {
  const excluded = new Set(settings.value[side])
  for (const key of keys) {
    if (included) {
      excluded.delete(key)
    } else {
      excluded.add(key)
    }
  }
  set({ [side]: [...excluded] })
}
</script>

<style scoped lang="scss">
// The settings across the panel's width, in a grid that wraps on narrow
// screens.
.cal-transfer-settings {
  display: grid;
  gap: 0.75rem 2rem;
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main-bis);
  font-size: 0.875rem;
  flex: 0 0 auto;

  // Sized by its own width, which the page's sidebar changes too.
  &.cal-transfer-settings-wait-walk {
    display: block;
    container-type: inline-size;
  }

  // Arriving and departing side by side; one above the other on narrow
  // screens.
  &.cal-transfer-settings-trips {
    grid-template-columns: repeat(2, minmax(0, 1fr));

    @media (max-width: 48rem) {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  > * {
    margin-bottom: 0;
    min-width: 0;
  }
}

// Walking and the grade scale at their own width, connections the rest, in
// one row where the panel is wide. Narrower, connections take a row of their
// own, their two options side by side; narrower still, everything stacks.
.cal-transfer-settings-wait-walk-grid {
  display: grid;
  gap: 0.75rem 2rem;
  grid-template-columns: max-content minmax(0, 1fr);
  grid-template-areas:
    'walk connections'
    'grades grades';

  > * {
    margin-bottom: 0;
    min-width: 0;
  }

  .cal-transfer-settings-walk {
    grid-area: walk;
  }

  .cal-transfer-settings-connections {
    grid-area: connections;
  }

  .cal-transfer-settings-grades {
    grid-area: grades;
  }

  .cal-transfer-settings-options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container (max-width: 64rem) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'walk'
      'connections'
      'grades';
  }

  @container (max-width: 40rem) {
    .cal-transfer-settings-options {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}

.cal-transfer-settings-options {
  display: grid;
  gap: 0.25rem 1.5rem;

  p {
    margin-bottom: 0.4rem;
  }
}

.cal-transfer-settings-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 1rem;
  margin-bottom: 0.4rem;
}

.cal-transfer-settings-number {
  :deep(input) {
    width: 3.5rem;
  }
}

// Inputs and grade chips alternating on one line.
.cal-transfer-settings-scale {
  display: flex;
  align-items: stretch;
  gap: 0.35rem;
  margin-bottom: 0.4rem;
  overflow-x: auto;

  .cal-transfer-settings-number {
    align-self: center;
  }
}

// A grade's band, sharing the bar's width: its name over its range.
.cal-transfer-settings-band {
  flex: 1 1 0;
  min-width: 5.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  line-height: 1.2;
  white-space: nowrap;

  strong {
    color: inherit;
  }
}

// Beyond the ends, plainly.
.cal-transfer-settings-band-none {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--bulma-text-weak);
  border: 1px dashed var(--bulma-border);
}

.cal-transfer-settings-help {
  color: var(--bulma-text-weak);
  font-size: 0.75rem;
}

.cal-transfer-settings-warning {
  color: var(--bulma-warning-on-scheme, var(--bulma-text-strong));
  font-size: 0.75rem;
}

.cal-transfer-settings-link {
  background: none;
  border: 0;
  padding: 0;
  margin-left: 0.5rem;
  font: inherit;
  color: var(--bulma-link);
  cursor: pointer;
  text-decoration: underline;
}

.cal-transfer-settings-side {
  min-width: 0;
}

.cal-transfer-settings-side-head {
  display: flex;
  align-items: baseline;
  font-size: 0.75rem;
  margin-bottom: 0.25rem;

  span {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--bulma-text-strong);
    margin-right: 0.25rem;
  }
}

// One line per row, the count at the end, scrolling past a dozen or so.
.cal-transfer-settings-list {
  max-height: 12rem;
  overflow-y: auto;
  margin: 0;
  list-style: none;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
  background: var(--bulma-scheme-main);
}

.cal-transfer-settings-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-bottom: 1px solid var(--bulma-border-weak);

  &:last-child {
    border-bottom: 0;
  }

  // An operator's row: a heading over its routes, which keep their indent.
  &.cal-transfer-settings-operator {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--bulma-text-weak);
    background: var(--bulma-scheme-main-bis);
  }

  &.cal-transfer-settings-depth-1 {
    padding-left: 1.75rem;
  }

  &.cal-transfer-settings-depth-2 {
    padding-left: 3rem;
  }

  &.cal-transfer-settings-depth-3 {
    padding-left: 4.25rem;
  }

  // A direction or destination, under its route.
  &.cal-transfer-settings-sub {
    font-size: 0.8125rem;
  }
}

.cal-transfer-settings-caret {
  flex: 0 0 1.25rem;
  background: none;
  border: 0;
  padding: 0;
  color: var(--bulma-text-weak);
  cursor: pointer;
}

.cal-transfer-settings-item-check {
  flex: 1 1 auto;
  min-width: 0;

  :deep(label),
  :deep(.checkbox) {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
  }
}

.cal-transfer-settings-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-transfer-settings-origin {
  flex: 0 1 auto;
  min-width: 3rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--bulma-text-weak);
}

.cal-transfer-settings-tag {
  flex: 0 0 auto;
  height: 1.4em;
  font-size: 0.7rem;
}

.cal-transfer-settings-view-trips {
  background: none;
  border: 0;
  padding: 0 0.25rem;
  color: var(--bulma-link);
  cursor: pointer;
}

.cal-transfer-settings-count {
  color: var(--bulma-text-weak);
  font-variant-numeric: tabular-nums;
}
</style>
