<template>
  <!-- Connections as flows around the stops: from the places arriving trips
       come from, through the stops, to the places departing trips go; one
       color per place of origin, each flow as wide as its connections. A
       table beside breaks the flows down by origin, arriving trip, and
       departing trip, with their connections by grade. Clicking a place, a
       flow, or a row focuses its flows; clicking it again clears. -->
  <div class="cal-transfer-rose">
    <figure class="cal-transfer-rose-figure">
      <p v-if="rose.flows.length === 0" class="cal-transfer-rose-empty">
        No connections to show.
      </p>
      <div v-else class="cal-transfer-rose-frame" :style="{ aspectRatio: `${WIDTH} / ${HEIGHT}` }">
        <svg :viewBox="`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`" aria-hidden="true">
          <defs>
            <marker v-for="(color, i) of PALETTE" :id="`${uid}-${i}`" :key="color" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="1.4" markerHeight="1.4" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" :fill="color" />
            </marker>
          </defs>
          <g class="cal-transfer-rose-rings">
            <template v-for="ring of rings" :key="ring.km">
              <circle :r="ring.r" />
              <text :x="ring.r * Math.SQRT1_2 + 2" :y="-ring.r * Math.SQRT1_2 - 2">{{ ring.km }} km</text>
            </template>
          </g>
          <path
            v-for="f of drawn"
            :key="f.id"
            class="cal-transfer-rose-flow"
            :class="{ 'cal-transfer-rose-faded': emphasis && !emphasis.has(f.flow), 'cal-transfer-rose-strong': emphasis?.has(f.flow) }"
            :d="f.d"
            :stroke="PALETTE[f.color]"
            :stroke-width="f.width"
            :marker-end="`url(#${uid}-${f.color})`"
            @mouseenter="hover = { id: f.id, flows: new Set([f.flow]), text: flowText(f.flow) }"
            @mouseleave="hover = undefined"
            @click="setFocus(`pair:${f.flow.from}>${f.flow.to}`, rose.flows.filter(x => x.from === f.flow.from && x.to === f.flow.to))"
          />
          <line
            v-for="p of placed"
            :key="`port-${p.name}`"
            class="cal-transfer-rose-port"
            v-bind="p.port"
            @click="focusPlace(p.name)"
          />
          <circle class="cal-transfer-rose-center" r="5" />
        </svg>
        <span class="cal-transfer-rose-north" :style="at(0, -HEIGHT / 2 + 8)">N</span>
        <button
          v-for="p of placed"
          :key="`label-${p.name}`"
          type="button"
          class="cal-transfer-rose-label"
          :class="[`cal-transfer-rose-label-${p.labelX < 0 ? 'left' : 'right'}`, { 'cal-transfer-rose-label-focused': focus?.id === `place:${p.name}` }]"
          :style="at(p.labelX, p.labelY)"
          :aria-pressed="focus?.id === `place:${p.name}`"
          @click="focusPlace(p.name)"
          @mouseenter="hover = { id: `place:${p.name}`, flows: placeFlows(p.name), text: placeText(p.name) }"
          @mouseleave="hover = undefined"
        >
          <span v-if="p.color !== undefined" class="cal-transfer-rose-swatch" :style="{ background: PALETTE[p.color] }" />{{ p.name }}
        </button>
      </div>
      <figcaption class="cal-transfer-rose-caption">
        {{ hover?.text ?? (focus ? focus.text : 'Connections from where arriving trips come from to where departing trips go, each as wide as its number. Click a place, flow, or row to focus it.') }}
      </figcaption>
    </figure>

    <!-- The flows by origin, arriving trip, and departing trip. -->
    <div class="cal-transfer-rose-table" role="table" aria-label="Connections by where trips come from and go">
      <div class="cal-transfer-rose-row cal-transfer-rose-head" role="row">
        <span role="columnheader">From / arriving trip / departing trip</span>
        <span role="columnheader" class="cal-transfer-rose-num">Connections</span>
        <span role="columnheader">By wait</span>
      </div>
      <div
        v-for="row of rows"
        :key="row.id"
        role="row"
        class="cal-transfer-rose-row"
        :class="[`cal-transfer-rose-depth-${row.depth}`, { 'cal-transfer-rose-row-focused': focus?.id === row.id, 'cal-transfer-rose-row-hovered': hover?.flows && row.flows.every(f => hover!.flows.has(f)) }]"
        @mouseenter="hover = { id: row.id, flows: new Set(row.flows), text: row.text }"
        @mouseleave="hover = undefined"
      >
        <span role="cell" class="cal-transfer-rose-name">
          <button
            v-if="row.depth < 2"
            type="button"
            class="cal-transfer-rose-caret"
            :aria-expanded="opened.has(row.id)"
            :aria-label="`${opened.has(row.id) ? 'Hide' : 'Show'} what is under ${row.label}`"
            @click="toggleOpen(row.id)"
          >
            <cat-icon size="small" :icon="opened.has(row.id) ? 'chevron-down' : 'chevron-right'" />
          </button>
          <button type="button" class="cal-transfer-rose-focus" :aria-pressed="focus?.id === row.id" @click="setFocus(row.id, row.flows, row.text)">
            <span v-if="row.color !== undefined" class="cal-transfer-rose-swatch" :style="{ background: PALETTE[row.color] }" />
            <cal-route-badge v-if="row.route" :label="row.route" :title="row.agency" />
            <span class="cal-transfer-rose-text">{{ row.label }}</span>
            <span v-if="row.place" class="cal-transfer-rose-place">to {{ row.place }}</span>
          </button>
        </span>
        <span role="cell" class="cal-transfer-rose-num">{{ row.total.toLocaleString() }}</span>
        <span role="cell">
          <cat-tooltip :text="gradesText(row.grades)" class="cal-transfer-rose-bar">
            <span
              v-for="g of TRANSFER_GRADES"
              :key="g"
              :style="{ flexGrow: row.grades[g], background: TRANSFER_GRADE_COLORS[g].fill }"
            />
          </cat-tooltip>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import {
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  type TransferGradeCounts,
  type TransferRose,
  type TransferRoseFlow,
} from '~~/src/scenario'

const props = defineProps<{
  rose: TransferRose
}>()

const uid = useId()
const WIDTH = 560
const HEIGHT = 420
// Places lie between these radii, by the square root of their distance.
const INNER = 70
const OUTER = 175
// The widest place's flows, side by side, at most this wide.
const MOST_WIDTH = 44
const LABEL_GAP = 14
const MIN_SPREAD = 10
// One color per place of origin: none of the grades' colors, which the
// table uses.
const PALETTE = ['#7a4dda', '#2a9d8f', '#c2185b', '#8c6d31', '#5b6470', '#9e9d24', '#00838f', '#6d4c41', '#ad1457', '#3949ab']

// A unit vector along a bearing, in the SVG's frame (y down); and across it.
function along (bearing: number): [number, number] {
  const a = (bearing * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

const maxKm = computed(() => Math.max(0.1, ...props.rose.places.map(p => p.km)))
function radius (km: number): number {
  return INNER + (OUTER - INNER) * Math.sqrt(Math.min(km, maxKm.value) / maxKm.value)
}
const rings = computed(() => [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  .filter(km => km <= maxKm.value)
  .slice(-3)
  .map(km => ({ km, r: radius(km) })))

// Each origin's color, by bearing.
const colors = computed(() => {
  const origins = props.rose.places.filter(p => props.rose.flows.some(f => f.from === p.name))
  return new Map(origins.map((p, i) => [p.name, i % PALETTE.length]))
})

// Each place's flows out (from it) and in (to it), and their width.
const scale = computed(() => {
  const totals = props.rose.places.map(p => props.rose.flows.reduce((n, f) => n + (f.from === p.name ? f.total : 0) + (f.to === p.name ? f.total : 0), 0))
  return MOST_WIDTH / Math.max(1, ...totals)
})

// The angles to draw places at: their bearings, fanned apart where they
// would draw on top of one another.
function spread (bearings: number[]): number[] {
  const order = bearings.map((_, i) => i).sort((a, b) => bearings[a]! - bearings[b]!)
  const angles = [...bearings]
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    for (let k = 0; k < order.length - 1; k++) {
      const [i, j] = [order[k]!, order[k + 1]!]
      const short = MIN_SPREAD - (angles[j]! - angles[i]!)
      if (short > 0.01) {
        angles[i] = angles[i]! - short / 2
        angles[j] = angles[j]! + short / 2
        moved = true
      }
    }
    if (!moved) {
      break
    }
  }
  return angles
}

// Places on the rose: where, the bar where their flows meet them, and their
// labels, spread apart down each side.
const placed = computed(() => {
  const angles = spread(props.rose.places.map(p => p.bearing))
  const out = props.rose.places.map((p, i) => {
    const angle = angles[i]!
    const [ux, uy] = along(angle)
    const r = radius(p.km)
    const total = props.rose.flows.reduce((n, f) => n + (f.from === p.name ? f.total : 0) + (f.to === p.name ? f.total : 0), 0)
    const half = Math.max(2, (total * scale.value) / 2)
    const [tx, ty] = [-uy, ux]
    const x = ux * r
    const y = uy * r
    const labelR = r + 8
    return {
      ...p,
      angle,
      r,
      x,
      y,
      color: colors.value.get(p.name),
      port: { x1: x - tx * half, y1: y - ty * half, x2: x + tx * half, y2: y + ty * half },
      labelX: ux * labelR + (ux < 0 ? -2 : 2),
      labelY: uy * labelR,
    }
  })
  for (const left of [true, false]) {
    const labels = out.filter(p => (p.labelX < 0) === left).sort((a, b) => a.labelY - b.labelY)
    let last = Number.NEGATIVE_INFINITY
    for (const p of labels) {
      p.labelY = Math.max(p.labelY, last + LABEL_GAP, -HEIGHT / 2 + LABEL_GAP)
      last = p.labelY
    }
    let next = Number.POSITIVE_INFINITY
    for (const p of [...labels].reverse()) {
      p.labelY = Math.min(p.labelY, next - LABEL_GAP, HEIGHT / 2 - LABEL_GAP / 2)
      next = p.labelY
    }
  }
  return out
})

// Each flow as a curve from its origin's bar, by the stops, to its
// destination's, side by side with the others at each bar: those leaving a
// place first, then those reaching it, each in the order of the other end.
const drawn = computed(() => {
  const at = new Map(placed.value.map(p => [p.name, p]))
  const slots = new Map<string, number>()
  const offset = (place: string, width: number) => {
    const p = at.get(place)!
    const total = (p.port.x2 - p.port.x1) ** 2 + (p.port.y2 - p.port.y1) ** 2
    const used = slots.get(place) ?? 0
    slots.set(place, used + width)
    return used + width / 2 - Math.sqrt(total) / 2
  }
  const angleOf = (name: string) => at.get(name)?.angle ?? 0
  const leaving = [...props.rose.flows].sort((a, b) => angleOf(a.to) - angleOf(b.to))
  const reaching = [...props.rose.flows].sort((a, b) => angleOf(a.from) - angleOf(b.from))
  const starts = new Map(leaving.map(f => [f, offset(f.from, Math.max(1, f.total * scale.value))]))
  const ends = new Map(reaching.map(f => [f, offset(f.to, Math.max(1, f.total * scale.value))]))
  return props.rose.flows.map((f, i) => {
    const a = at.get(f.from)!
    const b = at.get(f.to)!
    const point = (p: typeof a, o: number, k: number): [number, number] => {
      const [ux, uy] = along(p.angle)
      return [ux * p.r * k - uy * o, uy * p.r * k + ux * o]
    }
    const s = point(a, starts.get(f)!, 1)
    const c1 = point(a, starts.get(f)! * 0.4, 0.3)
    const c2 = point(b, ends.get(f)! * 0.4, 0.3)
    // Short of the bar, for the arrowhead.
    const e = point(b, ends.get(f)!, 1 - 6 / b.r)
    const n = (v: number) => v.toFixed(1)
    return {
      id: `f${i}`,
      flow: f,
      color: colors.value.get(f.from) ?? 0,
      width: Math.max(1, f.total * scale.value),
      d: `M${n(s[0])},${n(s[1])} C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(e[0])},${n(e[1])}`,
    }
  })
})

// The flows focused, by a click, and those under the pointer; the latter
// shows first.
interface Emphasis { id: string, flows: Set<TransferRoseFlow>, text: string }
const focus = ref<Emphasis>()
const hover = ref<Emphasis>()
const emphasis = computed(() => (hover.value ?? focus.value)?.flows)

function setFocus (id: string, flows: TransferRoseFlow[], text?: string) {
  focus.value = focus.value?.id === id ? undefined : { id, flows: new Set(flows), text: text ?? flowsText(flows) }
}

function placeFlows (name: string) {
  return new Set(props.rose.flows.filter(f => f.from === name || f.to === name))
}

function focusPlace (name: string) {
  setFocus(`place:${name}`, [...placeFlows(name)], placeText(name))
}

function sumOf (flows: TransferRoseFlow[]): { total: number, grades: TransferGradeCounts } {
  const grades: TransferGradeCounts = { missed: 0, close: 0, acceptable: 0, unacceptable: 0 }
  for (const f of flows) {
    for (const g of TRANSFER_GRADES) {
      grades[g] += f.grades[g]
    }
  }
  return { total: flows.reduce((n, f) => n + f.total, 0), grades }
}

function connections (n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'connection' : 'connections'}`
}

function gradesText (grades: TransferGradeCounts): string {
  return TRANSFER_GRADES.filter(g => grades[g] > 0).map(g => `${grades[g].toLocaleString()} ${TRANSFER_GRADE_LABELS[g].toLowerCase()}`).join(', ')
}

function flowsText (flows: TransferRoseFlow[]): string {
  const { total, grades } = sumOf(flows)
  const first = flows[0]
  const ends = first && flows.every(f => f.from === first.from && f.to === first.to) ? `From ${first.from} to ${first.to}: ` : ''
  return `${ends}${connections(total)} (${gradesText(grades)}).`
}

function flowText (f: TransferRoseFlow): string {
  const from = props.rose.from.get(f.fromKey)
  const to = props.rose.to.get(f.toKey)
  return `${from?.route ?? ''} ${from?.label ?? ''} from ${f.from}, to ${to?.route ?? ''} ${to?.label ?? ''} toward ${f.to}: ${connections(f.total)} (${gradesText(f.grades)}).`
}

function placeText (name: string): string {
  const flows = [...placeFlows(name)]
  const out = sumOf(flows.filter(f => f.from === name)).total
  const into = sumOf(flows.filter(f => f.to === name)).total
  return `${name}: ${connections(out)} by trips from here, ${connections(into)} onto trips going here.`
}

// The table's rows: each origin, by most connections; under it, when opened,
// its arriving trips; under each of those, when opened, its departing trips.
const opened = ref(new Set<string>())
function toggleOpen (id: string) {
  const next = new Set(opened.value)
  if (!next.delete(id)) {
    next.add(id)
  }
  opened.value = next
}

interface Row {
  id: string
  depth: number
  label: string
  route?: string
  agency?: string
  place?: string
  color?: number
  flows: TransferRoseFlow[]
  total: number
  grades: TransferGradeCounts
  text: string
}

function byTotal<K> (flows: TransferRoseFlow[], keyOf: (f: TransferRoseFlow) => K): [K, TransferRoseFlow[]][] {
  const groups = new Map<K, TransferRoseFlow[]>()
  for (const f of flows) {
    const k = keyOf(f)
    groups.set(k, [...(groups.get(k) ?? []), f])
  }
  return [...groups].sort((a, b) => sumOf(b[1]).total - sumOf(a[1]).total)
}

const rows = computed((): Row[] => byTotal(props.rose.flows, f => f.from).flatMap(([origin, flows]) => {
  const id = `from:${origin}`
  const row: Row = { id, depth: 0, label: origin, color: colors.value.get(origin), flows, ...sumOf(flows), text: '' }
  row.text = `From ${origin}: ${connections(row.total)} (${gradesText(row.grades)}).`
  if (!opened.value.has(id)) {
    return [row]
  }
  return [row, ...byTotal(flows, f => f.fromKey).flatMap(([fromKey, arrivals]) => {
    const trip = props.rose.from.get(fromKey)
    const arrivalId = `${id}|${fromKey}`
    const arrival: Row = { id: arrivalId, depth: 1, label: trip?.label ?? '', route: trip?.route, agency: trip?.agency, flows: arrivals, ...sumOf(arrivals), text: '' }
    arrival.text = `${trip?.route ?? ''} ${trip?.label ?? ''} from ${origin}: ${connections(arrival.total)} (${gradesText(arrival.grades)}).`
    if (!opened.value.has(arrivalId)) {
      return [arrival]
    }
    return [arrival, ...byTotal(arrivals, f => f.toKey).map(([toKey, pair]): Row => {
      const to = props.rose.to.get(toKey)
      return { id: `${arrivalId}>${toKey}`, depth: 2, label: to?.label ?? '', route: to?.route, agency: to?.agency, place: pair[0]!.to, flows: pair, ...sumOf(pair), text: flowText(pair[0]!) }
    })]
  })]
}))

// A point in the SVG's frame as a position over it.
function at (x: number, y: number) {
  return { left: `${((x + WIDTH / 2) / WIDTH) * 100}%`, top: `${((y + HEIGHT / 2) / HEIGHT) * 100}%` }
}
</script>

<style scoped lang="scss">
// The rose beside its table; one above the other where narrow.
.cal-transfer-rose {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(18rem, 2fr);
  gap: 1rem 1.5rem;
  align-items: start;
  font-size: 0.8rem;

  @media (max-width: 64rem) {
    grid-template-columns: minmax(0, 1fr);
  }
}

.cal-transfer-rose-figure {
  margin: 0;
}

.cal-transfer-rose-empty,
.cal-transfer-rose-caption {
  color: var(--bulma-text-weak);
}

.cal-transfer-rose-caption {
  min-height: 2.5em;
  margin-top: 0.25rem;
}

.cal-transfer-rose-frame {
  position: relative;
  width: 100%;

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
}

.cal-transfer-rose-rings {
  circle {
    fill: none;
    stroke: var(--bulma-border);
    stroke-dasharray: 2 3;
  }

  text {
    font-size: 8px;
    fill: var(--bulma-text-weak);
  }
}

.cal-transfer-rose-flow {
  fill: none;
  opacity: 0.55;
  cursor: pointer;
  transition: opacity 0.15s;
}

.cal-transfer-rose-strong {
  opacity: 0.9;
}

.cal-transfer-rose-faded {
  opacity: 0.08;
}

.cal-transfer-rose-port {
  stroke: var(--bulma-text);
  stroke-width: 3;
  stroke-linecap: round;
  cursor: pointer;
}

.cal-transfer-rose-center {
  fill: var(--bulma-text);
}

.cal-transfer-rose-north {
  position: absolute;
  transform: translate(-50%, -50%);
  font-weight: 600;
  color: var(--bulma-text-weak);
}

.cal-transfer-rose-label {
  position: absolute;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 11rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  line-height: 1.1;
  color: var(--bulma-text);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}

.cal-transfer-rose-label-left {
  transform: translate(-100%, -50%);
  flex-direction: row-reverse;
}

.cal-transfer-rose-label-focused {
  font-weight: 600;
}

.cal-transfer-rose-swatch {
  display: inline-block;
  flex: none;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 2px;
}

// The table, scrolling within the rose's height.
.cal-transfer-rose-table {
  max-height: 32rem;
  overflow-y: auto;
  border: 1px solid var(--bulma-border);
  border-radius: 4px;
}

.cal-transfer-rose-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 5.5rem 5rem;
  gap: 0.5rem;
  align-items: center;
  padding: 0.2rem 0.5rem;
  border-top: 1px solid var(--bulma-border-weak);
}

.cal-transfer-rose-head {
  position: sticky;
  top: 0;
  z-index: 1;
  border-top: 0;
  background: var(--bulma-scheme-main-bis);
  font-weight: 600;
}

.cal-transfer-rose-depth-0 {
  font-weight: 600;
}

.cal-transfer-rose-depth-1 .cal-transfer-rose-name {
  padding-left: 1.25rem;
}

.cal-transfer-rose-depth-2 .cal-transfer-rose-name {
  padding-left: 2.75rem;
}

.cal-transfer-rose-row-hovered {
  background: var(--bulma-scheme-main-bis);
}

.cal-transfer-rose-row-focused {
  background: var(--bulma-scheme-main-ter);
}

.cal-transfer-rose-name {
  display: flex;
  align-items: center;
  min-width: 0;
}

.cal-transfer-rose-caret {
  flex: none;
  background: none;
  border: 0;
  padding: 0;
  color: var(--bulma-text-weak);
  cursor: pointer;
}

.cal-transfer-rose-focus {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-width: 0;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;

  > * {
    flex: none;
  }
}

.cal-transfer-rose-text,
.cal-transfer-rose-place {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cal-transfer-rose-place {
  color: var(--bulma-text-weak);
  font-weight: normal;
}

.cal-transfer-rose-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.cal-transfer-rose-bar {
  display: flex;
  height: 0.6rem;
  width: 100%;
  border-radius: 2px;
  overflow: hidden;
  background: var(--bulma-scheme-main-ter);

  > span {
    flex-basis: 0;
  }
}
</style>
