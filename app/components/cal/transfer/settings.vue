<template>
  <section class="p-5" :aria-label="section === 'trips' ? 'Trip filtering' : 'Wait and walking settings'">
    <template v-if="section === 'wait-walk'">
      <div class="columns">
        <div class="column">
          <cat-fieldset label="Walking between stops">
            <div class="field">
              <cat-radio
                v-for="o of walkOptions"
                :key="o.value"
                :model-value="settings.walkDistance"
                :native-value="o.value"
                @update:model-value="set({ walkDistance: $event as TransferSettings['walkDistance'] })"
              >
                <cat-tooltip :text="o.tooltip">
                  {{ o.label }}
                </cat-tooltip>
              </cat-radio>
            </div>
            <label class="is-flex is-flex-wrap-wrap is-align-items-center is-gap-2">
              Seconds per meter
              <cat-input
                :key="`pace-${emptied.pace ?? 0}`"
                :model-value="settings.secondsPerMeter"
                :model-modifiers="{ lazy: true }"
                optional
                type="number"
                min="0.1"
                step="0.1"
                class="cal-transfer-settings-number"
                v-bind="{ ariaLabel: 'Walking seconds per meter' }"
                @update:model-value="ifNumber('pace', $event, n => set({ secondsPerMeter: n }))"
              />
              <span class="has-text-grey">{{ pace }}; no walk at the same stop</span>
            </label>
            <p v-if="unknownPairs > 0" class="has-text-warning-on-scheme mt-3">
              No distance for {{ unknownPairs }} {{ unknownPairs === 1 ? 'pair' : 'pairs' }} of stops; transfers between them are left out.
            </p>
          </cat-fieldset>
        </div>
        <div class="column">
          <cat-fieldset label="Connections">
            <div class="field">
              <cat-checkbox :model-value="settings.allConnections" @update:model-value="set({ allConnections: !!$event })">
                Show every connection
              </cat-checkbox>
              <p class="has-text-grey">
                Otherwise each arrival shows its first connection to each route,
                direction, and destination, and any it missed before then.
              </p>
            </div>
            <div class="field">
              <cat-checkbox :model-value="settings.countSameWay" @update:model-value="set({ countSameWay: !!$event })">
                Count trips back or on the same way
              </cat-checkbox>
              <p class="has-text-grey">
                A trip going back the way the arriving one came, or on the way
                it goes, is not a change a rider needs, so is not counted as a
                transfer unless checked.
              </p>
            </div>
          </cat-fieldset>
        </div>
      </div>

      <!-- The grades as a bar across the wait: each grade in its color with
           its range, and between the grades, the waits that bound them. -->
      <cat-fieldset label="Grades (minutes of wait)">
        <div class="cal-transfer-settings-scale">
          <template v-for="(bound, i) of bounds" :key="`${bound}-${emptied[bound] ?? 0}`">
            <cat-input
              :model-value="minutes(settings.breakpoints[i])"
              :model-modifiers="{ lazy: true }"
              optional
              type="number"
              step="0.5"
              class="cal-transfer-settings-number"
              v-bind="{ ariaLabel: `${bound}, in minutes` }"
              @update:model-value="ifNumber(bound, $event, n => setBreakpoint(i, n))"
            />
            <span
              v-if="TRANSFER_GRADES[i]"
              class="cal-transfer-settings-band"
              :style="{ background: TRANSFER_GRADE_COLORS[TRANSFER_GRADES[i]!].fill, color: TRANSFER_GRADE_COLORS[TRANSFER_GRADES[i]!].text }"
            >
              <span class="is-block has-text-weight-bold">{{ TRANSFER_GRADE_LABELS[TRANSFER_GRADES[i]!] }}</span>
              <span class="is-block">{{ range(i) }}</span>
            </span>
          </template>
        </div>
        <p class="has-text-grey">
          Waits outside these ranges are not transfers.
          <span v-if="!breakpointsValid" class="has-text-warning-on-scheme">Each must be more than the one before; the defaults apply until then.</span>
          <button type="button" class="cal-link-button ml-2" @click="set({ breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] })">
            Reset
          </button>
        </p>
      </cat-fieldset>
    </template>

    <!-- Arriving and departing trips side by side: each route, its
         directions ("Toward X"), and their destinations, opened on request,
         with trip counts. -->
    <div v-else class="columns">
      <div v-for="side of sides" :key="side.key" class="column cal-transfer-settings-side" role="group" :aria-label="`${side.legend} trips`">
        <p class="mb-2">
          <strong>{{ side.legend }} trips</strong>
          <button type="button" class="cal-link-button ml-2" @click="set({ [side.key]: [] })">
            All
          </button>
          <button type="button" class="cal-link-button ml-2" @click="set({ [side.key]: [...new Set(side.rows.flatMap(r => r.keys))] })">
            None
          </button>
        </p>
        <ul class="cal-transfer-settings-list">
          <li
            v-for="row of side.rows"
            :key="row.id"
            class="cal-transfer-settings-item"
            :class="row.operator ? 'cal-transfer-settings-operator' : `cal-transfer-settings-depth-${row.depth}`"
          >
            <!-- An operator's routes show unless closed; a direction's
                 destinations, once opened. -->
            <button
              v-if="row.toggle"
              type="button"
              class="cal-link-button cal-transfer-settings-caret"
              :aria-expanded="row.toggle.open"
              :aria-label="`${row.toggle.open ? 'Hide' : 'Show'} ${row.toggle.shows} ${row.label}`"
              @click="toggle(row.toggle.key)"
            >
              <cat-icon size="small" :icon="row.toggle.open ? 'chevron-down' : 'chevron-right'" />
            </button>
            <span v-else class="cal-transfer-settings-caret" />
            <cat-checkbox
              class="cal-transfer-settings-item-check"
              :model-value="row.state !== 'none'"
              :indeterminate="row.state === 'some'"
              @update:model-value="setKeys(side.key, row.keys, !!$event)"
            >
              <cal-route-badge v-if="row.badge" :label="row.badge" :title="row.title" />
              <span class="cal-transfer-settings-clip" :title="row.title">{{ row.label }}</span>
              <span v-if="row.origin" class="cal-transfer-settings-clip has-text-grey" :title="`From ${row.origin}`">from {{ row.origin }}</span>
              <cal-transfer-trip-tags :tags="row.tags" />
            </cat-checkbox>
            <button
              v-if="row.routeId !== undefined"
              type="button"
              class="cal-link-button px-1"
              :title="`View trips for route ${row.badge}`"
              :aria-label="`View trips for route ${row.badge}`"
              @click="emit('openTrips', row.routeId)"
            >
              <cat-icon size="small" icon="table-clock" />
            </button>
            <span class="has-text-grey">{{ row.count.toLocaleString() }}</span>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  DEFAULT_TRANSFER_SETTINGS,
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  choiceDestinations,
  validBreakpoints,
  transferTripTags,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferTripDestination,
  type TransferTripTag,
} from '~~/src/scenario'
import { compareNamesBlankLast, groupBy } from '~~/src/core'

// The panel to show: waits and walking, or trip filtering.
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

// Merges each change onto the last one sent: the model shows a change only
// once the page applies the change, so two changes in one tick would
// otherwise lose one.
let latest: TransferSettings | undefined
function set (change: Partial<TransferSettings>) {
  latest = { ...(latest ?? settings.value), ...change }
  settings.value = latest
  nextTick(() => {
    latest = undefined
  })
}

const walkOptions: { value: TransferSettings['walkDistance'], label: string, tooltip: string }[] = [
  { value: 'line', label: 'Straight line', tooltip: 'The straight-line distance between the stops.' },
  { value: 'street', label: 'Street network', tooltip: 'The distance along streets and paths, from OpenStreetMap; a straight line where no route is found.' },
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

// The breakpoints' labels, by the grade each starts, or for the last, ends.
const bounds = [...TRANSFER_GRADES.map(g => `${TRANSFER_GRADE_LABELS[g]} from`), `${TRANSFER_GRADE_LABELS.unacceptable} up to`]

// A grade's range in minutes, between the breakpoints either side of it:
// "-5 to 0".
function range (i: number): string {
  const [from, to] = [minutes(settings.value.breakpoints[i]), minutes(settings.value.breakpoints[i + 1])]
  return `${from ?? ''} to ${to ?? ''}`
}

function minutes (seconds: number | undefined): number | undefined {
  return seconds === undefined ? undefined : seconds / 60
}

// Applies a field's number. An empty or non-numeric field changes nothing,
// rather than reading as 0, and is redrawn by key to show its value again,
// as cat-input keeps the emptied text while the value stays the same.
const emptied = ref<Record<string, number>>({})
function ifNumber (field: string, value: unknown, apply: (n: number) => void) {
  const n = value === '' || value === null || value === undefined ? Number.NaN : Number(value)
  if (Number.isFinite(n)) {
    apply(n)
  } else {
    emptied.value = { ...emptied.value, [field]: (emptied.value[field] ?? 0) + 1 }
  }
}

function setBreakpoint (index: number, mins: number) {
  const breakpoints = [...settings.value.breakpoints]
  breakpoints[index] = mins * 60
  set({ breakpoints })
}

const breakpointsValid = computed(() => validBreakpoints(settings.value.breakpoints))

type Side = 'excludedFrom' | 'excludedTo'

// One line of a side's list: an operator, a route, a direction, or a
// destination, with the destination keys its checkbox covers.
interface Row {
  id: string
  depth: number
  badge?: string
  label: string
  title?: string
  count: number
  keys: string[]
  // For one destination: an arriving one's origin, and its tags.
  origin?: string
  tags: TransferTripTag[]
  // On a route's first row, the route, to show its trips.
  routeId?: number
  // An operator's heading row over its routes.
  operator?: boolean
  // Set where the row opens and closes: its key, whether it is open, and what
  // it shows, for its button's label.
  toggle?: { key: string, open: boolean, shows: string }
  // Whether all, some, or none of the keys are included.
  state: 'all' | 'some' | 'none'
}

// Rows switched from how they start: operators start open, showing their
// routes, and directions start closed, hiding their destinations.
const toggled = ref(new Set<string>())
function toggle (key: string) {
  const next = new Set(toggled.value)
  if (!next.delete(key)) {
    next.add(key)
  }
  toggled.value = next
}

// With routes from more than one operator, each operator's routes under its
// own row, operators by name; otherwise the routes alone.
function rows (side: Side, routes: TransferRouteChoice[]): Omit<Row, 'state'>[] {
  const byOperator = groupBy(routes, r => r.operator)
  if (byOperator.size < 2) {
    return routeRows(side, routes)
  }
  return [...byOperator]
    .sort(([a], [b]) => compareNamesBlankLast(a, b))
    .flatMap(([operator, list]) => {
      const key = `operator|${side}|${operator}`
      const open = !toggled.value.has(key)
      return [
        {
          id: `o${operator}`,
          depth: 0,
          label: operator || 'Unknown operator',
          count: list.reduce((n, r) => n + r.count, 0),
          keys: choiceDestinations(list).map(x => x.key),
          tags: [],
          operator: true,
          toggle: { key, open, shows: 'routes of' },
        },
        // A level in from the operator.
        ...(open ? routeRows(side, list, 1) : []),
      ]
    })
}

// A route with one direction at the stops is one row; with two, a row and a
// row per direction. A direction with several destinations opens to them.
function routeRows (side: Side, routes: TransferRouteChoice[], base = 0): Omit<Row, 'state'>[] {
  const out: Omit<Row, 'state'>[] = []
  const tripSide = side === 'excludedFrom' ? 'from' : 'to'
  const about = (d: TransferTripDestination | undefined) => ({
    // A destination labeled "From" its origin shows no separate origin.
    origin: tripSide === 'from' && !d?.namedByOrigin ? d?.run.origin : undefined,
    tags: transferTripTags(d, tripSide),
  })
  for (const route of routes) {
    const single = route.directions.length === 1
    const routeKeys = choiceDestinations([route]).map(x => x.key)
    const title = route.longName || route.label
    for (const [i, dir] of route.directions.entries()) {
      const depth = base + (single ? 0 : 1)
      const key = dir.destinations.length > 1 ? `direction|${side}|${route.id}|${dir.directionId}` : undefined
      const open = !!key && toggled.value.has(key)
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
        toggle: key ? { key, open, shows: 'destinations for' } : undefined,
        ...(dir.destinations.length === 1 ? about(dir.destinations[0]) : { tags: [] }),
        routeId: single ? route.id : undefined,
      })
      if (open) {
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
// Number fields as wide as their few digits: at full width, five of them
// would push the grade bar off the panel.
.cal-transfer-settings-number {
  flex: none;
  width: 5rem;
}

// Inputs and grade bands alternating on one line, scrolling sideways where
// the panel is narrow.
.cal-transfer-settings-scale {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  overflow-x: auto;
}

// A grade's band, sharing the bar's width: its name over its range. Never
// narrower than those, so the bar scrolls instead.
.cal-transfer-settings-band {
  flex: 1 1 0;
  min-width: max-content;
  padding: 0.5em 0.75em;
  border-radius: var(--bulma-radius-small);
  text-align: center;
  white-space: nowrap;
}

// Each side's column shrinks with the panel, cutting its rows short.
.cal-transfer-settings-side {
  min-width: 0;
}

// One line per row, the count at the end, scrolling past a handful.
.cal-transfer-settings-list {
  max-height: 20rem;
  overflow-y: auto;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
}

.cal-transfer-settings-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5em 0.75em;
  border-bottom: 1px solid var(--bulma-border-weak);

  &:last-child {
    border-bottom: 0;
  }

  // An operator's row: a heading over its routes, which keep their indent.
  &.cal-transfer-settings-operator {
    font-weight: 600;
    background: var(--bulma-scheme-main-bis);
  }

  // Each level in by a caret's width and the gap that follows.
  &.cal-transfer-settings-depth-1 {
    padding-left: 2.5rem;
  }

  &.cal-transfer-settings-depth-2 {
    padding-left: 4.25rem;
  }

  &.cal-transfer-settings-depth-3 {
    padding-left: 6rem;
  }
}

// A caret's room, kept on a row without one, so the rows line up.
.cal-transfer-settings-caret {
  flex: 0 0 1.25rem;
}

.cal-transfer-settings-item-check {
  flex: 1 1 auto;
  min-width: 0;
}

.cal-transfer-settings-clip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
