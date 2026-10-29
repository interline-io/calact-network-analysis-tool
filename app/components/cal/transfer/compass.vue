<template>
  <!-- Places trips come from or go to, around the stops by bearing and
       distance, to pick trips by: each place and each compass point
       toggles its trips. -->
  <figure class="cal-transfer-compass" :aria-label="label">
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
            <text :x="ring.x" :y="ring.y" text-anchor="middle" dominant-baseline="middle">{{ ring.km }} km</text>
          </template>
        </g>
        <!-- Leaders from a place to its label, where the label moved off it. -->
        <template v-for="p of layout" :key="`leader-${p.key}`">
          <line v-if="Math.abs(p.labelY - p.y) > 2" class="cal-transfer-compass-leader" :x1="p.x" :y1="p.y" :x2="p.labelX" :y2="p.labelY" />
        </template>
        <!-- A line to each place, arrowed in the trips' direction. -->
        <line
          v-for="p of layout"
          :key="`line-${p.key}`"
          class="cal-transfer-compass-line"
          :class="`cal-transfer-compass-line-${p.state}`"
          v-bind="arrowEnds(p)"
          :marker-end="`url(#${uid}-${p.state === 'none' ? 'off' : 'on'})`"
        />
        <circle
          v-for="p of layout"
          :key="`dot-${p.key}`"
          class="cal-transfer-compass-dot"
          :class="`cal-transfer-compass-dot-${p.state}`"
          :cx="p.x"
          :cy="p.y"
          :r="p.dot"
          @click="toggle(p)"
        />
        <circle class="cal-transfer-compass-center" r="5" />
      </svg>
      <!-- Compass points, each toggling the trips of the places that way. -->
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
      <!-- Each place's name, toggling its trips. -->
      <cat-tooltip
        v-for="p of layout"
        :key="`label-${p.key}`"
        :text="p.text"
        class="cal-transfer-compass-label"
        :class="[`cal-transfer-compass-label-${p.labelX < 0 ? 'left' : 'right'}`, `cal-transfer-compass-label-${p.state}`]"
        :style="at(p.labelX, p.labelY)"
      >
        <button type="button" :aria-pressed="p.state === 'all' ? 'true' : p.state === 'some' ? 'mixed' : 'false'" @click="toggle(p)">
          {{ p.name }}
        </button>
      </cat-tooltip>
    </div>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { along, compassRings, compassScale, quietBearing, spreadBearings, spreadLabels, type TransferCompassPlace } from '~~/src/scenario'

const props = defineProps<{
  // Named for the screen reader; the list beside it says the rest.
  label: string
  places: TransferCompassPlace[]
  // Where trips arrive from ('from') or depart to ('to').
  side: 'from' | 'to'
  // The destinations left out.
  excluded: string[]
}>()

const emit = defineEmits<{
  // Include or leave out these destinations.
  toggle: [keys: string[], included: boolean]
}>()

const uid = useId()
const WIDTH = 480
const HEIGHT = 300
// Places lie between these radii, by distance on a log scale, so near ones
// spread out.
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

const hoveredSector = ref<number>()

const maxKm = computed(() => Math.max(0.1, ...props.places.map(p => p.km)))
function radius (km: number): number {
  return INNER + (OUTER - INNER) * compassScale(km, maxKm.value)
}
// Rings, labeled along the widest gap between places.
const rings = computed(() => {
  const [ux, uy] = along(quietBearing(layout.value.map(p => p.angle)))
  return compassRings(maxKm.value).map((km) => {
    const r = radius(km)
    return { km, r, x: ux * r, y: uy * r }
  })
})

const layout = computed(() => {
  const excluded = new Set(props.excluded)
  const maxCount = Math.max(1, ...props.places.map(p => p.count))
  const angles = spreadBearings(props.places.map(p => p.bearing), MIN_SPREAD)
  const placed = props.places.map((p, i) => {
    const angle = angles[i]!
    const [ux, uy] = along(angle)
    const r = radius(p.km)
    const x = ux * r
    const y = uy * r
    const out = p.keys.filter(k => excluded.has(k)).length
    const state = out === 0 ? 'all' as const : out === p.keys.length ? 'none' as const : 'some' as const
    return {
      ...p,
      x,
      y,
      r,
      state,
      dot: 3 + 4 * Math.sqrt(p.count / maxCount),
      angle,
      text: placeText(p, state),
      labelX: x + (x < 0 ? -8 : 8),
      labelY: y,
    }
  })
  spreadLabels(placed, -HEIGHT / 2 + LABEL_GAP, HEIGHT / 2 - LABEL_GAP / 2, LABEL_GAP)
  return placed
})

// Places at least this many degrees apart.
const MIN_SPREAD = 8

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

function placeText (p: TransferCompassPlace, state: 'all' | 'some' | 'none'): string {
  const trips = `${p.count.toLocaleString()} ${p.count === 1 ? 'trip' : 'trips'}`
  const where = `${DIRECTION[props.side]} ${p.name}, to the ${NAMES[sectorOf(p.bearing)]}`
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
  emit('toggle', p.keys, p.state !== 'all')
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
    stroke: var(--bulma-scheme-main);
    stroke-width: 3px;
    paint-order: stroke;
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
  stroke: #c9cdd2;
  stroke-width: 1;
}

.cal-transfer-compass-dot {
  stroke-width: 1.5;
  stroke: #7a4dda;
  fill: #7a4dda;
}

.cal-transfer-compass-dot {
  cursor: pointer;
}

.cal-transfer-compass-dot-some {
  fill: #c9b8f0;
}

.cal-transfer-compass-dot-none {
  stroke: #9aa1ab;
  fill: var(--bulma-scheme-main);
}

.cal-transfer-compass-center {
  fill: var(--bulma-text);
}

// Labels and compass points sit over the drawing, centered on their point
// (a label, beside it).
.cal-transfer-compass-point,
.cal-transfer-compass-label {
  position: absolute;
  line-height: 1;
}

.cal-transfer-compass-point {
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
}
</style>
