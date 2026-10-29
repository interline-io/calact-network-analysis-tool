<template>
  <!-- A dial of trip origins or destinations around the stops, by bearing
       and distance. Clicking a place or a compass point includes or leaves
       out its trips. -->
  <figure :aria-label="side === 'from' ? 'Origins of arriving trips' : 'Destinations of departing trips'">
    <!-- The frame keeps its size while empty, so the list below stays put as
         places arrive. -->
    <div ref="frame" class="is-relative cal-transfer-compass-frame">
      <svg :viewBox="`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`" class="is-block" aria-hidden="true">
        <defs>
          <marker v-for="m of MARKERS" :id="`${uid}-${m.id}`" :key="m.id" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" :fill="m.color" />
          </marker>
        </defs>
        <path v-if="hoveredSector !== undefined" :d="sectorPath(hoveredSector)" :fill="TRANSFER_PICKED_COLOR" fill-opacity="0.08" />
        <g class="cal-transfer-compass-rings">
          <template v-for="ring of rings" :key="ring.km">
            <circle :r="ring.r" />
            <text :x="ring.x" :y="ring.y" text-anchor="middle" dominant-baseline="middle">{{ ring.km }} km</text>
          </template>
        </g>
        <!-- A leader from each labeled place to its label. -->
        <line
          v-for="l of labels"
          :key="`leader-${l.key}`"
          class="cal-transfer-compass-leader"
          :x1="l.x"
          :y1="l.y"
          :x2="l.left ? 2 - LABEL_X : LABEL_X - 2"
          :y2="l.labelY"
        />
        <!-- A line to each place, arrowed in the trips' direction. -->
        <line
          v-for="p of layout"
          :key="`line-${p.key}`"
          class="cal-transfer-compass-line"
          :class="`cal-transfer-compass-${p.state}`"
          v-bind="arrowEnds(p)"
          :marker-end="`url(#${uid}-${p.state === 'none' ? 'off' : 'on'})`"
        />
        <!-- A place without room for a label still names itself on hover. -->
        <circle
          v-for="p of layout"
          :key="`dot-${p.key}`"
          class="cal-transfer-compass-dot"
          :class="`cal-transfer-compass-${p.state}`"
          :cx="p.x"
          :cy="p.y"
          :r="p.dot"
          @click="toggle(p.keys, p.state)"
        >
          <title>{{ p.text }}</title>
        </circle>
        <circle v-if="layout.length > 0" r="5" fill="currentColor" />
      </svg>
      <p v-if="layout.length === 0" class="is-overlay is-flex is-align-items-center is-justify-content-center has-text-grey">
        No places to show.
      </p>
      <!-- Compass points, each toggling the trips of the places drawn that
           way. -->
      <cat-tooltip
        v-for="s of sectors"
        :key="s.short"
        :text="s.text"
        class="cal-transfer-compass-point"
        :style="at(s.x, s.y)"
      >
        <button
          type="button"
          class="cal-link-button has-text-weight-semibold"
          :disabled="s.keys.length === 0"
          :aria-label="s.text"
          @click="toggle(s.keys, s.state)"
          @mouseenter="hoveredSector = s.index"
          @mouseleave="hoveredSector = undefined"
          @focus="hoveredSector = s.index"
          @blur="hoveredSector = undefined"
        >
          {{ s.short }}
        </button>
      </cat-tooltip>
      <!-- Each labeled place's name, toggling its trips. -->
      <cat-tooltip
        v-for="l of labels"
        :key="`label-${l.key}`"
        :text="l.text"
        class="cal-transfer-compass-label"
        :class="{ 'cal-transfer-compass-label-left': l.left }"
        :style="at(l.left ? -LABEL_X : LABEL_X, l.labelY)"
      >
        <button
          type="button"
          class="cal-link-button"
          :class="{ 'has-text-grey': l.state === 'none' }"
          :aria-pressed="l.state === 'all' ? 'true' : l.state === 'some' ? 'mixed' : 'false'"
          @click="toggle(l.keys, l.state)"
        >
          {{ l.name }}
        </button>
      </cat-tooltip>
    </div>
  </figure>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { TRANSFER_PICKED_COLOR, TRANSFER_UNPICKED_COLOR } from '~~/src/core'
import { along, columnLabels, compassRings, compassScale, quietBearing, spreadBearings, type TransferCompassPlace } from '~~/src/scenario'
import { useDrawingText } from '~/composables/useDrawingText'

const props = defineProps<{
  places: TransferCompassPlace[]
  // Which trips the places are for: arriving ('from') or departing ('to').
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
// Places at least this many degrees apart.
const MIN_SPREAD = 8
// Labels line up this far either side of the middle, clear of the outer
// ring, each at most as wide as the room left before the frame's edge.
const LABEL_X = OUTER + 12
const labelRoom = `${((WIDTH / 2 - LABEL_X - 8) / WIDTH) * 100}%`
const MARKERS = [{ id: 'on', color: TRANSFER_PICKED_COLOR }, { id: 'off', color: TRANSFER_UNPICKED_COLOR }]
// The compass points, clockwise from north.
const POINTS = [
  { short: 'N', name: 'north' },
  { short: 'NE', name: 'northeast' },
  { short: 'E', name: 'east' },
  { short: 'SE', name: 'southeast' },
  { short: 'S', name: 'south' },
  { short: 'SW', name: 'southwest' },
  { short: 'W', name: 'west' },
  { short: 'NW', name: 'northwest' },
]
// E and W lie this far either side of the middle.
const SIDE = OUTER + 26

const hoveredSector = ref<number>()
const frame = ref<HTMLElement>()
const text = useDrawingText(frame, WIDTH)

// Each compass point where its ray from the middle meets a box around the
// dial: N, NE and NW in a row along the top, and S, SE and SW along the
// bottom, clear of the labels and their leaders; E and W in the middle of
// the label columns.
const points = computed(() => {
  const top = HEIGHT / 2 - text.value.row / 2
  return POINTS.map((point, i) => {
    const [ux, uy] = along(i * 45)
    const t = Math.min(SIDE / Math.abs(ux), top / Math.abs(uy))
    return { ...point, x: ux * t, y: uy * t }
  })
})

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

const excluded = computed(() => new Set(props.excluded))

const layout = computed(() => {
  const maxCount = Math.max(1, ...props.places.map(p => p.count))
  const angles = spreadBearings(props.places.map(p => p.bearing), MIN_SPREAD)
  return props.places.map((p, i) => {
    const angle = angles[i]!
    const [ux, uy] = along(angle)
    const r = radius(p.km)
    const state = stateOf(p.keys)
    return {
      ...p,
      x: ux * r,
      y: uy * r,
      r,
      state,
      dot: 3 + 4 * Math.sqrt(p.count / maxCount),
      angle,
      text: placeText(p, angle, state),
    }
  })
})

// The labels, in a column either side of the dial, each as level with its
// place as the others allow: between the rows of compass points along the
// top and bottom, and around the one (W or E) in the column's middle. Where
// a column runs out of room, the places with the fewest trips go unlabeled.
const labels = computed(() => {
  const { row } = text.value
  return [true, false].flatMap((left) => {
    const side = layout.value.filter(p => (p.x < 0) === left)
    const ys = columnLabels(side.map(p => ({ y: p.y, weight: p.count })), -HEIGHT / 2 + row * 1.5, HEIGHT / 2 - row * 1.5, row, [-row, row])
    return side.flatMap((p, i) => {
      const labelY = ys[i]
      return labelY === undefined ? [] : [{ ...p, left, labelY }]
    })
  })
})

// Each compass point with the destinations of the places drawn in its
// wedge, toggled together.
const sectors = computed(() => points.value.map((point, i) => {
  const places = layout.value.filter(p => sectorOf(p.angle) === i)
  const keys = places.flatMap(p => p.keys)
  const state = stateOf(keys)
  const text = places.length === 0
    ? `No trips ${props.side} the ${point.name}`
    : `${state === 'none' ? 'Include' : 'Leave out'} trips ${props.side} the ${point.name}: ${places.map(p => p.name).join(', ')}`
  return { ...point, index: i, keys, state, text }
}))

// A line from the stops to a place, arrowed toward the stops for arriving
// trips and toward the place for departing ones.
function arrowEnds (p: { angle: number, r: number, dot: number }) {
  const [ux, uy] = along(p.angle)
  const near = 8
  const far = p.r - p.dot - 1
  const [a, b] = props.side === 'to' ? [near, far] : [far, near]
  return { x1: ux * a, y1: uy * a, x2: ux * b, y2: uy * b }
}

// Whether all, some or none of some destinations are included.
function stateOf (keys: string[]): 'all' | 'some' | 'none' {
  const out = keys.filter(k => excluded.value.has(k)).length
  return out === 0 ? 'all' : out === keys.length ? 'none' : 'some'
}

// A place's description, naming the compass point it's drawn toward: the
// point that toggles the place.
function placeText (p: TransferCompassPlace, angle: number, state: 'all' | 'some' | 'none'): string {
  const trips = `${p.count.toLocaleString()} ${props.side === 'from' ? 'arriving' : 'departing'} ${p.count === 1 ? 'trip' : 'trips'}`
  const included = { all: 'included', some: 'some included', none: 'excluded' }[state]
  return `${p.name}, ${POINTS[sectorOf(angle)]!.name} of the stops: ${trips}, ${included}. Click to ${state === 'none' ? 'include' : 'exclude'} them.`
}

// The compass point nearest an angle in degrees, which may lie past 360 or
// below 0 once spread.
function sectorOf (angle: number): number {
  return Math.round((((angle % 360) + 360) % 360) / 45) % 8
}

// A wedge of the compass, highlighted as its point is hovered.
function sectorPath (i: number): string {
  const [ax, ay] = along(i * 45 - 22.5)
  const [bx, by] = along(i * 45 + 22.5)
  const r = OUTER + 6
  return `M0,0 L${(ax * r).toFixed(1)},${(ay * r).toFixed(1)} A${r},${r} 0 0 1 ${(bx * r).toFixed(1)},${(by * r).toFixed(1)} Z`
}

// Includes the destinations where none are, else leaves them all out, as a
// checkbox in the list below does.
function toggle (keys: string[], state: 'all' | 'some' | 'none') {
  emit('toggle', keys, state === 'none')
}

// A point in SVG coordinates as a CSS position over the frame.
function at (x: number, y: number) {
  return { left: `${((x + WIDTH / 2) / WIDTH) * 100}%`, top: `${((y + HEIGHT / 2) / HEIGHT) * 100}%` }
}
</script>

<style scoped lang="scss">
// The dial at most this wide, so it stays compact over its list.
.cal-transfer-compass-frame {
  max-width: 34rem;
}

// Ring labels stay small enough to fit between the rings, which lie closer
// together than a line of text.
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

.cal-transfer-compass-leader {
  stroke: var(--bulma-border);
  stroke-width: 0.75;
}

.cal-transfer-compass-line {
  stroke: v-bind(TRANSFER_PICKED_COLOR);
  stroke-width: 1.5;

  &.cal-transfer-compass-some {
    stroke-dasharray: 4 2;
  }

  &.cal-transfer-compass-none {
    stroke: v-bind(TRANSFER_UNPICKED_COLOR);
    stroke-width: 1;
  }
}

.cal-transfer-compass-dot {
  stroke: v-bind(TRANSFER_PICKED_COLOR);
  stroke-width: 1.5;
  fill: v-bind(TRANSFER_PICKED_COLOR);
  cursor: pointer;

  &.cal-transfer-compass-some {
    fill: color-mix(in srgb, v-bind(TRANSFER_PICKED_COLOR) 40%, var(--bulma-scheme-main));
  }

  &.cal-transfer-compass-none {
    stroke: v-bind(TRANSFER_UNPICKED_COLOR);
    fill: var(--bulma-scheme-main);
  }
}

// Compass points and place labels over the drawing: a point centered on its
// spot, and a label in its column, within the room between the outer ring
// and the frame's edge.
.cal-transfer-compass-point,
.cal-transfer-compass-label {
  position: absolute;
  line-height: 1;
  white-space: nowrap;
}

.cal-transfer-compass-point {
  transform: translate(-50%, -50%);
}

.cal-transfer-compass-label {
  max-width: v-bind(labelRoom);
  transform: translateY(-50%);

  button {
    display: block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.cal-transfer-compass-label-left {
  transform: translate(-100%, -50%);
}
</style>
