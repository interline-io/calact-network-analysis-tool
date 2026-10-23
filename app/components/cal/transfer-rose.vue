<template>
  <!-- Connections as flows around the stops: from the places arriving trips
       come from, through the stops, to the places departing trips go, each
       flow as wide as its connections, all one neutral color, with what is
       focused in the accent. A table beside breaks the flows down by
       origin, arriving trip, and departing trip, with their connections by
       grade. Clicking a place, a flow, or a row focuses its flows, hiding the
       rest, until cleared. -->
  <div class="cal-transfer-rose">
    <figure class="cal-transfer-rose-figure">
      <!-- A place focused: its trips from it, or to it. -->
      <cat-tabs v-if="focus?.place" class="cal-transfer-rose-side" :model-value="focus.side" type="toggle" @update:model-value="focusPlace(focus.place, $event as 'from' | 'to', true)">
        <cat-tab-item value="from" label="Trips from here" />
        <cat-tab-item value="to" label="Trips to here" />
      </cat-tabs>
      <p v-if="rose.flows.length === 0" class="cal-transfer-rose-empty">
        No connections to show.
      </p>
      <div v-else class="cal-transfer-rose-frame" :style="{ aspectRatio: `${WIDTH} / ${HEIGHT}` }">
        <svg :viewBox="`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`" aria-hidden="true">
          <defs>
            <marker v-for="(color, key) of COLORS" :id="`${uid}-${key}`" :key="key" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="1.4" markerHeight="1.4" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" :fill="color" />
            </marker>
          </defs>
          <g class="cal-transfer-rose-rings">
            <template v-for="ring of rings" :key="ring.km">
              <circle :r="ring.r" />
              <text :x="ring.x" :y="ring.y" text-anchor="middle" dominant-baseline="middle">{{ ring.km }} km</text>
            </template>
          </g>
          <!-- One ribbon per pair of places; where some of its flows are
               focused, a narrower one over it, as wide as those. -->
          <template v-for="f of drawn" :key="f.id">
            <path
              class="cal-transfer-rose-flow"
              :class="{ 'cal-transfer-rose-faded': emphasis }"
              :d="f.d"
              :stroke="COLORS.band"
              :stroke-width="f.width"
              :marker-end="emphasis ? undefined : `url(#${uid}-band)`"
              @mouseenter="hover = { id: f.id, flows: new Set(f.flows), text: flowsText(f.flows) }"
              @mouseleave="hover = undefined"
              @click="setFocus(f.id, f.flows)"
            />
            <path
              v-if="emphasis && f.emphasized > 0"
              class="cal-transfer-rose-flow cal-transfer-rose-strong"
              :d="f.d"
              :stroke="COLORS.accent"
              :stroke-width="Math.max(1, f.emphasized * scale)"
              :marker-end="`url(#${uid}-accent)`"
            />
          </template>
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
          :class="[`cal-transfer-rose-label-${p.labelX < 0 ? 'left' : 'right'}`, { 'cal-transfer-rose-label-focused': focus?.place === p.name, 'cal-transfer-rose-label-faded': emphasis && !p.involved }]"
          :style="at(p.labelX, p.labelY)"
          :aria-pressed="focus?.place === p.name"
          @click="focusPlace(p.name)"
          @mouseenter="hover = { id: `place:${p.name}`, flows: placeFlows(p.name), text: placeText(p.name) }"
          @mouseleave="hover = undefined"
        >
          <span class="cal-transfer-rose-label-name">{{ p.name }}</span>
        </button>
      </div>
      <figcaption class="cal-transfer-rose-caption">
        <template v-if="hover || focus">
          {{ (hover ?? focus)!.text }}
        </template>
        <template v-else>
          Each band pairs where arriving trips come from with where departing
          trips go, as wide as the connections the schedule offers between
          them, not riders.
          <cat-tooltip text="Places sit in their direction from the stops; distance is on a log scale, and crowded places are spread apart. Hover a place or band for its counts.">
            <cat-icon icon="information" size="small" /><span class="is-sr-only">How to read the compass</span>
          </cat-tooltip>
          Click a place, band, or row to focus it.
        </template>
      </figcaption>
    </figure>

    <!-- The flows by origin, arriving trip, and departing trip. -->
    <div class="cal-transfer-rose-table" role="table" aria-label="Connections by where trips come from and go">
      <div class="cal-transfer-rose-row cal-transfer-rose-head" role="row">
        <span role="columnheader">From / arriving trip / departing trip</span>
        <span role="columnheader" class="cal-transfer-rose-num">Connections</span>
        <span role="columnheader">By wait</span>
        <span role="columnheader" class="cal-transfer-rose-view">View</span>
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
        <span role="cell" class="cal-transfer-rose-view">
          <cat-tooltip text="Show in Individual">
            <button type="button" aria-label="Show in Individual" @click="show(row.flows)">
              <cat-icon size="small" icon="table-arrow-right" />
            </button>
          </cat-tooltip>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { escapeHtml } from '~~/src/core'
import {
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  compassRings,
  compassScale,
  quietBearing,
  type TransferFocus,
  type TransferGradeCounts,
  type TransferRose,
  type TransferRoseFlow,
} from '~~/src/scenario'

const props = defineProps<{
  rose: TransferRose
}>()

const emit = defineEmits<{
  // Narrow the trip filters to these flows' trips, and show Individual.
  show: [focus: TransferFocus]
}>()

const uid = useId()
const WIDTH = 680
const HEIGHT = 420
// Places lie between these radii, by the square root of their distance.
const INNER = 70
const OUTER = 175
// The widest place's flows, side by side, at most this wide.
const MOST_WIDTH = 44
const LABEL_GAP = 14
const MIN_SPREAD = 10
// One neutral color for every band, as a color would suggest more than which
// pairing it is; and the accent for what is focused or under the pointer.
const COLORS = { band: '#9aa1ab', accent: '#7a4dda' }

// A unit vector along a bearing, in the SVG's frame (y down); and across it.
function along (bearing: number): [number, number] {
  const a = (bearing * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

const maxKm = computed(() => Math.max(0.1, ...props.rose.places.map(p => p.km)))
function radius (km: number): number {
  return INNER + (OUTER - INNER) * compassScale(km, maxKm.value)
}
// Rings, labeled along the widest gap between places.
const rings = computed(() => {
  const [ux, uy] = along(quietBearing(placed.value.map(p => p.angle)))
  return compassRings(maxKm.value).map((km) => {
    const r = radius(km)
    return { km, r, x: ux * r, y: uy * r }
  })
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
  const focused = emphasis.value
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
      involved: !focused || [...focused].some(f => f.from === p.name || f.to === p.name),
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
  const pairs = byTotal(props.rose.flows, f => `${f.from}>${f.to}`)
    .map(([id, flows]) => ({ id: `pair:${id}`, from: flows[0]!.from, to: flows[0]!.to, flows, total: sumOf(flows).total }))
  const leaving = [...pairs].sort((a, b) => angleOf(a.to) - angleOf(b.to))
  const reaching = [...pairs].sort((a, b) => angleOf(a.from) - angleOf(b.from))
  const starts = new Map(leaving.map(f => [f, offset(f.from, Math.max(1, f.total * scale.value))]))
  const ends = new Map(reaching.map(f => [f, offset(f.to, Math.max(1, f.total * scale.value))]))
  const focused = emphasis.value
  return pairs.map((f) => {
    const a = at.get(f.from)!
    const b = at.get(f.to)!
    const point = (p: typeof a, o: number, k: number): [number, number] => {
      const [ux, uy] = along(p.angle)
      return [ux * p.r * k - uy * o, uy * p.r * k + ux * o]
    }
    // Through the stops: drawn in close to them from either end.
    const s = point(a, starts.get(f)!, 1)
    const c1 = point(a, starts.get(f)! * 0.3, 0.08)
    const c2 = point(b, ends.get(f)! * 0.3, 0.08)
    // Short of the bar, for the arrowhead.
    const e = point(b, ends.get(f)!, 1 - 6 / b.r)
    const n = (v: number) => v.toFixed(1)
    return {
      id: f.id,
      flows: f.flows,
      emphasized: focused ? f.flows.reduce((n, x) => n + (focused.has(x) ? x.total : 0), 0) : 0,
      width: Math.max(1, f.total * scale.value),
      d: `M${n(s[0])},${n(s[1])} C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(e[0])},${n(e[1])}`,
    }
  })
})

// The flows focused, by a click, and those under the pointer; the latter
// shows first.
// A place focused shows its trips from it or to it.
interface Emphasis { id: string, flows: Set<TransferRoseFlow>, text: string, place?: string, side?: 'from' | 'to' }
const focus = ref<Emphasis>()
const hover = ref<Emphasis>()
const emphasis = computed(() => (hover.value ?? focus.value)?.flows)

function setFocus (id: string, flows: TransferRoseFlow[], text?: string) {
  focus.value = focus.value?.id === id ? undefined : { id, flows: new Set(flows), text: text ?? flowsText(flows) }
}

function show (flows: TransferRoseFlow[]) {
  emit('show', {
    from: [...new Set(flows.map(x => x.fromKey))],
    to: [...new Set(flows.map(x => x.toKey))],
  })
}

function placeFlows (name: string) {
  return new Set(props.rose.flows.filter(f => f.from === name || f.to === name))
}

// A place's trips from it, where it has any, else to it; or the side asked
// for. Clicking the place focused clears it, unless switching sides.
function focusPlace (name: string, side?: 'from' | 'to', switching = false) {
  if (!switching && focus.value?.place === name) {
    focus.value = undefined
    return
  }
  const pick = side ?? (props.rose.flows.some(f => f.from === name) ? 'from' : 'to')
  const flows = props.rose.flows.filter(f => (pick === 'from' ? f.from : f.to) === name)
  const { total, grades } = sumOf(flows)
  focus.value = {
    id: `place:${name}`,
    flows: new Set(flows),
    text: `${pick === 'from' ? 'From' : 'To'} ${name}: ${connections(total)} (${gradesText(grades)}).`,
    place: name,
    side: pick,
  }
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
  const row: Row = { id, depth: 0, label: origin, flows, ...sumOf(flows), text: '' }
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

// The rose as a standalone SVG, as it shows (any focus too), its labels as
// text and its colors fixed, for download.
function toSvg (): string {
  const n = (v: number) => v.toFixed(1)
  const focused = emphasis.value
  const marker = (key: keyof typeof COLORS) => `<marker id="m-${key}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="1.4" markerHeight="1.4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${COLORS[key]}"/></marker>`
  const ribbon = (d: string, key: keyof typeof COLORS, width: number, opacity: number, arrow: boolean) =>
    `<path d="${d}" fill="none" stroke="${COLORS[key]}" stroke-width="${n(width)}" opacity="${opacity}"${arrow ? ` marker-end="url(#m-${key})"` : ''}/>`
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}" width="${WIDTH * 1.5}" height="${HEIGHT * 1.5}" font-family="sans-serif" font-size="11">`,
    `<defs>${marker('band')}${marker('accent')}</defs>`,
    `<rect x="${-WIDTH / 2}" y="${-HEIGHT / 2}" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    ...rings.value.map(r => `<circle r="${n(r.r)}" fill="none" stroke="#d5d8dc" stroke-dasharray="2 3"/><text x="${n(r.x)}" y="${n(r.y)}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="#6b7280" stroke="#ffffff" stroke-width="3" paint-order="stroke">${r.km} km</text>`),
    ...drawn.value.flatMap(f => [
      ribbon(f.d, 'band', f.width, focused ? 0.04 : 0.55, !focused),
      ...(focused && f.emphasized > 0 ? [ribbon(f.d, 'accent', Math.max(1, f.emphasized * scale.value), 0.9, true)] : []),
    ]),
    ...placed.value.map(p => `<line x1="${n(p.port.x1)}" y1="${n(p.port.y1)}" x2="${n(p.port.x2)}" y2="${n(p.port.y2)}" stroke="#363636" stroke-width="3" stroke-linecap="round"/>`),
    '<circle r="5" fill="#363636"/>',
    `<text x="0" y="${-HEIGHT / 2 + 12}" text-anchor="middle" font-weight="600" fill="#6b7280">N</text>`,
    ...placed.value.map((p) => {
      const left = p.labelX < 0
      return `<text x="${n(p.labelX)}" y="${n(p.labelY)}" dy="0.35em" text-anchor="${left ? 'end' : 'start'}" fill="#363636">${escapeHtml(p.name)}</text>`
    }),
    '</svg>',
  ]
  return parts.join('')
}

defineExpose({ toSvg })

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

.cal-transfer-rose-side {
  margin-bottom: 0.5rem;
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
    stroke: var(--bulma-scheme-main);
    stroke-width: 3px;
    paint-order: stroke;
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
  // The ribbon under it takes the pointer.
  pointer-events: none;
}

.cal-transfer-rose-faded {
  opacity: 0.04;
}

.cal-transfer-rose-label-faded {
  opacity: 0.35;
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

.cal-transfer-rose-label-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cal-transfer-rose-label-left {
  transform: translate(-100%, -50%);
  flex-direction: row-reverse;
}

.cal-transfer-rose-label-focused {
  font-weight: 600;
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
  grid-template-columns: minmax(0, 1fr) 5.5rem 5rem 2.5rem;
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

.cal-transfer-rose-view {
  text-align: center;

  button {
    display: inline-flex;
    background: none;
    border: 0;
    padding: 0;
    color: var(--bulma-text-weak);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      color: var(--bulma-link);
    }
  }
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
