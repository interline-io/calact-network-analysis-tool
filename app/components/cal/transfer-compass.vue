<template>
  <!-- Places trips come from or go to, around the stops by bearing and
       distance. To pick trips, each place and each compass point toggles
       its trips; to show results, each place's connections flow as a band,
       as wide as their number, striped by grade. -->
  <figure class="cal-transfer-compass" :class="{ 'cal-transfer-compass-select': selectable }">
    <figcaption class="cal-transfer-compass-title">
      {{ title }}
    </figcaption>
    <p v-if="layout.length === 0" class="cal-transfer-compass-empty">
      No places to show.
    </p>
    <div v-else class="cal-transfer-compass-frame" :style="{ aspectRatio: `${WIDTH} / ${HEIGHT}` }">
      <svg :viewBox="`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`" aria-hidden="true">
        <defs>
          <marker v-for="m of MARKERS" :id="`${uid}-${m.id}`" :key="m.id" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" :fill="m.color" />
          </marker>
        </defs>
        <path v-if="hoveredSector !== undefined" class="cal-transfer-compass-sector" :d="sectorPath(hoveredSector)" />
        <g class="cal-transfer-compass-rings">
          <template v-for="ring of rings" :key="ring.km">
            <circle :r="ring.r" />
            <text :x="ring.r * Math.SQRT1_2 + 2" :y="-ring.r * Math.SQRT1_2 - 2">{{ ring.km }} km</text>
          </template>
        </g>
        <!-- Leaders from a place to its label, where the label moved off it. -->
        <template v-for="p of layout" :key="`leader-${p.name}`">
          <line v-if="Math.abs(p.labelY - p.y) > 2" class="cal-transfer-compass-leader" :x1="p.x" :y1="p.y" :x2="p.labelX" :y2="p.labelY" />
        </template>
        <!-- To pick: a line to each place, arrowed in the trips' direction. -->
        <template v-if="!flows">
          <line
            v-for="p of layout"
            :key="`line-${p.name}`"
            class="cal-transfer-compass-line"
            :class="`cal-transfer-compass-line-${p.state}`"
            v-bind="arrowEnds(p)"
            :marker-end="`url(#${uid}-${p.state === 'none' ? 'off' : 'on'})`"
          />
          <circle
            v-for="p of layout"
            :key="`dot-${p.name}`"
            class="cal-transfer-compass-dot"
            :class="`cal-transfer-compass-dot-${p.state}`"
            :cx="p.x"
            :cy="p.y"
            :r="p.dot"
            @click="toggle(p)"
          />
        </template>
        <!-- Results: each place's connections as a band striped by grade. -->
        <template v-else>
          <g v-for="p of layout" :key="`band-${p.name}`">
            <line
              v-for="s of p.stripes"
              :key="s.grade"
              v-bind="s.ends"
              :stroke="TRANSFER_GRADE_COLORS[s.grade].fill"
              :stroke-width="s.width"
            />
            <path v-if="p.total > 0" class="cal-transfer-compass-head" :d="p.head" />
            <circle class="cal-transfer-compass-dot cal-transfer-compass-dot-place" :cx="p.x" :cy="p.y" r="2.5" />
          </g>
        </template>
        <circle class="cal-transfer-compass-center" r="5" />
      </svg>
      <!-- Compass points, each toggling the trips of the places that way. -->
      <template v-if="selectable">
        <cat-tooltip
          v-for="(point, i) of POINTS"
          :key="point.short"
          :text="sectorText(i)"
          class="cal-transfer-compass-point"
          :style="at(point.x, point.y)"
        >
          <button
            type="button"
            :disabled="sectorPlaces(i).length === 0"
            :aria-label="sectorText(i)"
            @click="toggleSector(i)"
            @mouseenter="hoveredSector = i"
            @mouseleave="hoveredSector = undefined"
            @focus="hoveredSector = i"
            @blur="hoveredSector = undefined"
          >
            {{ point.short }}
          </button>
        </cat-tooltip>
      </template>
      <span v-else class="cal-transfer-compass-north" :style="at(0, -HEIGHT / 2 + 8)">N</span>
      <!-- Each place's name, toggling its trips where picking. -->
      <cat-tooltip
        v-for="p of layout"
        :key="`label-${p.name}`"
        :text="p.text"
        class="cal-transfer-compass-label"
        :class="[`cal-transfer-compass-label-${p.labelX < 0 ? 'left' : 'right'}`, `cal-transfer-compass-label-${p.state}`]"
        :style="at(p.labelX, p.labelY)"
      >
        <button v-if="selectable" type="button" :aria-pressed="p.state === 'all' ? 'true' : p.state === 'some' ? 'mixed' : 'false'" @click="toggle(p)">
          {{ p.name }}
        </button>
        <span v-else>{{ p.name }}</span>
      </cat-tooltip>
    </div>
    <p v-if="flows && layout.length > 0" class="cal-transfer-compass-key">
      <span v-for="g of TRANSFER_GRADES" :key="g"><span class="cal-transfer-compass-swatch" :style="{ background: TRANSFER_GRADE_COLORS[g].fill }" />{{ TRANSFER_GRADE_LABELS[g] }}</span>
    </p>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import {
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  sumGrades,
  type TransferCompassPlace,
  type TransferGrade,
  type TransferGradeCounts,
} from '~~/src/scenario'

const props = defineProps<{
  title: string
  places: TransferCompassPlace[]
  // Where trips arrive from ('from') or depart to ('to').
  side: 'from' | 'to'
  // To pick: the destinations left out. Its absence means no picking.
  excluded?: string[]
  // Results: connections by grade by destination.
  flows?: Map<string, TransferGradeCounts>
}>()

const emit = defineEmits<{
  // Include or leave out these destinations.
  toggle: [keys: string[], included: boolean]
}>()

const uid = useId()
const WIDTH = 480
const HEIGHT = 300
// Places lie between these radii, by the square root of their distance, so
// near ones spread out.
const INNER = 18
const OUTER = 118
// Labels at least this far apart.
const LABEL_GAP = 13
const PICKED = '#7a4dda'
const OTHER = '#9aa1ab'
const MARKERS = [{ id: 'on', color: PICKED }, { id: 'off', color: OTHER }]
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((short, i) => {
  const angle = (i * 45 * Math.PI) / 180
  // On an ellipse, as the frame is wider than tall.
  return { short, x: Math.sin(angle) * (OUTER + 26), y: -Math.cos(angle) * (HEIGHT / 2 - 12) }
})
const NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']

const selectable = computed(() => props.excluded !== undefined)
const hoveredSector = ref<number>()

// Rings at round distances, up to three, inside the farthest place.
const maxKm = computed(() => Math.max(0.1, ...props.places.map(p => p.km)))
function radius (km: number): number {
  return INNER + (OUTER - INNER) * Math.sqrt(Math.min(km, maxKm.value) / maxKm.value)
}
const rings = computed(() => [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
  .filter(km => km <= maxKm.value)
  .slice(-3)
  .map(km => ({ km, r: radius(km) })))

// A unit vector along a bearing, in the SVG's frame (y down).
function along (bearing: number): [number, number] {
  const a = (bearing * Math.PI) / 180
  return [Math.sin(a), -Math.cos(a)]
}

interface Stripe { grade: TransferGrade, width: number, ends: { x1: number, y1: number, x2: number, y2: number } }

const layout = computed(() => {
  const excluded = new Set(props.excluded ?? [])
  const maxCount = Math.max(1, ...props.places.map(p => p.count))
  const totals = props.places.map(p => (props.flows ? sumGrades(props.flows, p.keys) : undefined))
  const maxTotal = Math.max(1, ...totals.map(t => (t ? TRANSFER_GRADES.reduce((n, g) => n + t[g], 0) : 0)))
  const widths = totals.map(t => (t ? bandWidth(TRANSFER_GRADES.reduce((n, g) => n + t[g], 0), maxTotal) : 0))
  const angles = spread(props.places.map(p => p.bearing), widths)
  const placed = props.places.map((p, i) => {
    const angle = angles[i]!
    const [ux, uy] = along(angle)
    const r = radius(p.km)
    const x = ux * r
    const y = uy * r
    const out = p.keys.filter(k => excluded.has(k)).length
    const state = out === 0 ? 'all' as const : out === p.keys.length ? 'none' as const : 'some' as const
    const grades = totals[i]
    const total = grades ? TRANSFER_GRADES.reduce((n, g) => n + grades[g], 0) : 0
    return {
      ...p,
      x,
      y,
      r,
      state,
      dot: 3 + 4 * Math.sqrt(p.count / maxCount),
      total,
      angle,
      ...bandOf(angle, r, grades, total, maxTotal),
      text: placeText(p, state, grades, total),
      labelX: x + (x < 0 ? -8 : 8),
      labelY: y,
    }
  })
  // Labels on each side spread apart down the frame, then back up where
  // they run off its foot.
  for (const left of [true, false]) {
    const labels = placed.filter(p => (p.labelX < 0) === left).sort((a, b) => a.y - b.y)
    const top = -HEIGHT / 2 + LABEL_GAP
    const bottom = HEIGHT / 2 - LABEL_GAP / 2
    let last = Number.NEGATIVE_INFINITY
    for (const p of labels) {
      p.labelY = Math.max(p.labelY, last + LABEL_GAP, top)
      last = p.labelY
    }
    let next = Number.POSITIVE_INFINITY
    for (const p of [...labels].reverse()) {
      p.labelY = Math.min(p.labelY, next - LABEL_GAP, bottom)
      next = p.labelY
    }
  }
  return placed
})

function bandWidth (total: number, maxTotal: number): number {
  return total > 0 ? Math.max(1.5, 16 * (total / maxTotal)) : 0
}

// The angles to draw places at: their bearings, fanned apart where they
// would draw on top of one another, at least MIN_SPREAD degrees, and more
// for wide bands, which leave the stops side by side.
const MIN_SPREAD = 8
function spread (bearings: number[], widths: number[]): number[] {
  const order = bearings.map((b, i) => i).sort((a, b) => bearings[a]! - bearings[b]!)
  const angles = [...bearings]
  const gap = (i: number, j: number) => Math.max(MIN_SPREAD, ((widths[i]! + widths[j]!) / 2 + 3) * 0.95)
  for (let pass = 0; pass < 60; pass++) {
    let moved = false
    for (let k = 0; k < order.length - 1; k++) {
      const [i, j] = [order[k]!, order[k + 1]!]
      const short = gap(i, j) - (angles[j]! - angles[i]!)
      if (short > 0.01) {
        angles[i]! -= short / 2
        angles[j]! += short / 2
        moved = true
      }
    }
    if (!moved) {
      break
    }
  }
  return angles
}

// A band from the stops to a place, as wide as its share of the most
// connections at any place, in stripes by grade; and its arrowhead, at the
// place for departing trips, at the stops for arriving ones.
function bandOf (bearing: number, r: number, grades: TransferGradeCounts | undefined, total: number, maxTotal: number): { stripes: Stripe[], head: string } {
  if (!grades || total === 0) {
    return { stripes: [], head: '' }
  }
  const [ux, uy] = along(bearing)
  const [nx, ny] = [-uy, ux]
  const width = bandWidth(total, maxTotal)
  const headLength = Math.min(8, Math.max(4, width * 0.6))
  const outward = props.side === 'to'
  const start = outward ? 7 : 7 + headLength
  const end = outward ? r - headLength : r
  const stripes: Stripe[] = []
  let offset = -width / 2
  for (const grade of TRANSFER_GRADES) {
    const w = (width * grades[grade]) / total
    if (w > 0) {
      const o = offset + w / 2
      stripes.push({ grade, width: w, ends: { x1: ux * start + nx * o, y1: uy * start + ny * o, x2: ux * end + nx * o, y2: uy * end + ny * o } })
      offset += w
    }
  }
  const half = width / 2 + 2
  const [base, tip] = outward ? [r - headLength, r] : [7 + headLength, 7]
  const head = [
    [ux * base + nx * half, uy * base + ny * half],
    [ux * tip, uy * tip],
    [ux * base - nx * half, uy * base - ny * half],
  ].map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x!.toFixed(1)},${y!.toFixed(1)}`).join(' ') + ' Z'
  return { stripes, head }
}

// A line from the stops to a place, arrowed toward the stops for arriving
// trips and toward the place for departing ones.
function arrowEnds (p: { angle: number, r: number, dot: number }) {
  const [ux, uy] = along(p.angle)
  const near = 8
  const far = p.r - p.dot - 1
  const [a, b] = props.side === 'to' ? [near, far] : [far, near]
  return { x1: ux * a, y1: uy * a, x2: ux * b, y2: uy * b }
}

const DIRECTION = { from: 'Arriving from', to: 'Departing to' }

function placeText (p: TransferCompassPlace, state: 'all' | 'some' | 'none', grades: TransferGradeCounts | undefined, total: number): string {
  const trips = `${p.count.toLocaleString()} ${p.count === 1 ? 'trip' : 'trips'}`
  const where = `${DIRECTION[props.side]} ${p.name}, ${Math.round(p.km)} km ${NAMES[sectorOf(p.bearing)]}`
  if (grades) {
    const byGrade = TRANSFER_GRADES.filter(g => grades[g] > 0).map(g => `${grades[g].toLocaleString()} ${TRANSFER_GRADE_LABELS[g].toLowerCase()}`).join(', ')
    return `${where}: ${total.toLocaleString()} ${total === 1 ? 'connection' : 'connections'}${byGrade ? ` (${byGrade})` : ''}, on ${trips}.`
  }
  const included = { all: 'included', some: 'some included', none: 'left out' }[state]
  return `${where}: ${trips}, ${included}. Click to ${state === 'all' ? 'leave them out' : 'include them'}.`
}

function sectorOf (bearing: number): number {
  return Math.round(bearing / 45) % 8
}

function sectorPlaces (i: number) {
  return layout.value.filter(p => sectorOf(p.bearing) === i)
}

function sectorText (i: number): string {
  const places = sectorPlaces(i)
  if (places.length === 0) {
    return `No trips ${props.side === 'from' ? 'from' : 'to'} the ${NAMES[i]}`
  }
  const all = places.every(p => p.state === 'all')
  return `${all ? 'Leave out' : 'Include'} trips ${props.side === 'from' ? 'from' : 'to'} the ${NAMES[i]}: ${places.map(p => p.name).join(', ')}`
}

// A wedge of the compass, highlighted as its point is hovered.
function sectorPath (i: number): string {
  const [ax, ay] = along(i * 45 - 22.5)
  const [bx, by] = along(i * 45 + 22.5)
  const r = OUTER + 6
  return `M0,0 L${(ax * r).toFixed(1)},${(ay * r).toFixed(1)} A${r},${r} 0 0 1 ${(bx * r).toFixed(1)},${(by * r).toFixed(1)} Z`
}

function toggle (p: { keys: string[], state: 'all' | 'some' | 'none' }) {
  if (selectable.value) {
    emit('toggle', p.keys, p.state !== 'all')
  }
}

function toggleSector (i: number) {
  const places = sectorPlaces(i)
  const all = places.every(p => p.state === 'all')
  emit('toggle', places.flatMap(p => p.keys), !all)
}

// A point in the SVG's frame as a position over it.
function at (x: number, y: number) {
  return { left: `${((x + WIDTH / 2) / WIDTH) * 100}%`, top: `${((y + HEIGHT / 2) / HEIGHT) * 100}%` }
}
</script>

<style scoped lang="scss">
.cal-transfer-compass {
  margin: 0;
  font-size: 0.75rem;
}

.cal-transfer-compass-title {
  font-weight: 600;
  font-size: 0.8rem;
}

.cal-transfer-compass-empty {
  color: var(--bulma-text-weak);
}

.cal-transfer-compass-frame {
  position: relative;
  width: 100%;
  max-width: 34rem;

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
}

.cal-transfer-compass-rings {
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

.cal-transfer-compass-sector {
  fill: #7a4dda;
  opacity: 0.08;
}

.cal-transfer-compass-leader {
  stroke: var(--bulma-border);
  stroke-width: 0.75;
}

.cal-transfer-compass-line {
  stroke-width: 1.5;
  stroke: #7a4dda;
}

.cal-transfer-compass-line-some {
  stroke-dasharray: 4 2;
}

.cal-transfer-compass-line-none {
  stroke: #9aa1ab;
  stroke-dasharray: 2 2;
}

.cal-transfer-compass-dot {
  stroke-width: 1.5;
  stroke: #7a4dda;
  fill: #7a4dda;
}

.cal-transfer-compass-select .cal-transfer-compass-dot {
  cursor: pointer;
}

.cal-transfer-compass-dot-some {
  fill: #c9b8f0;
}

.cal-transfer-compass-dot-none {
  stroke: #9aa1ab;
  fill: var(--bulma-scheme-main);
}

.cal-transfer-compass-dot-place {
  stroke: none;
  fill: #5b6470;
}

.cal-transfer-compass-head {
  fill: #5b6470;
}

.cal-transfer-compass-center {
  fill: var(--bulma-text);
}

// Labels and compass points sit over the drawing, centered on their point
// (a label, beside it).
.cal-transfer-compass-point,
.cal-transfer-compass-north,
.cal-transfer-compass-label {
  position: absolute;
  line-height: 1;
}

.cal-transfer-compass-point,
.cal-transfer-compass-north {
  transform: translate(-50%, -50%);
  font-weight: 600;
  color: var(--bulma-text-weak);
}

.cal-transfer-compass-point button {
  background: none;
  border: 0;
  border-radius: 3px;
  padding: 0.1rem 0.2rem;
  font: inherit;
  color: inherit;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--bulma-scheme-main-ter);
    color: var(--bulma-text-strong);
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}

.cal-transfer-compass-label {
  transform: translateY(-50%);
  white-space: nowrap;
  max-width: 9rem;

  button,
  span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 9rem;
  }

  button {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: var(--bulma-text);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      text-decoration: underline;
    }
  }
}

.cal-transfer-compass-label-left {
  transform: translate(-100%, -50%);
  text-align: right;
}

.cal-transfer-compass-label-none button {
  color: var(--bulma-text-weak);
  text-decoration: line-through;
}

.cal-transfer-compass-key {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.75rem;
  color: var(--bulma-text-weak);

  > span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
}

.cal-transfer-compass-swatch {
  display: inline-block;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 2px;
}
</style>
