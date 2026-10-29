<template>
  <!-- Connections as flows from arriving trips' origins, through the stops,
       to departing trips' destinations, each as wide as its connections. The
       table beside breaks them down from either end; checking rows, or
       clicking a place or band, highlights flows and filters nothing. -->
  <div class="columns is-desktop">
    <figure class="column is-three-fifths">
      <!-- The frame keeps its size while empty, so the table stays put as
           connections arrive. -->
      <div ref="frame" class="is-relative">
        <svg :viewBox="`${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}`" class="is-block" aria-hidden="true">
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
          <!-- A leader from each labeled place's bar to its label. -->
          <line v-for="l of labels" :key="`leader-${l.key}`" class="cal-transfer-rose-leader" v-bind="l.leader" />
          <!-- One ribbon per place pair, under a narrower accent ribbon for its
               highlighted flows. -->
          <template v-for="f of drawn" :key="f.id">
            <path
              class="cal-transfer-rose-flow"
              :class="{ 'cal-transfer-rose-faded': emphasis }"
              :d="f.d"
              :stroke="COLORS.band"
              :stroke-width="f.width"
              :marker-end="emphasis ? undefined : `url(#${uid}-band)`"
              @mouseenter="hover = { kind: 'band', id: f.id }"
              @mouseleave="hover = undefined"
              @click="toggleFlows(f.flows)"
            />
            <path
              v-if="emphasized.has(f.id)"
              class="cal-transfer-rose-flow cal-transfer-rose-strong"
              :d="f.d"
              :stroke="COLORS.accent"
              :stroke-width="emphasized.get(f.id)"
              :marker-end="`url(#${uid}-accent)`"
            />
          </template>
          <!-- Each place's bar, at the end of its bands. A place without room
               for a label still describes itself on hover. -->
          <line
            v-for="p of placed"
            :key="`port-${p.key}`"
            v-bind="p.port"
            class="is-clickable"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            @click="toggleFlows(placeFlows(p.key).flows)"
            @mouseenter="hover = { kind: 'place', id: p.key }"
            @mouseleave="hover = undefined"
          />
          <circle v-if="placed.length > 0" r="5" fill="currentColor" />
        </svg>
        <!-- Said only once trip details have loaded, which bring the
             connections. -->
        <p v-if="rose.flows.length === 0 && !loading" class="is-overlay is-flex is-align-items-center is-justify-content-center has-text-grey">
          No connections to show.
        </p>
        <span class="cal-transfer-rose-north has-text-grey has-text-weight-semibold" :style="at(0, -HEIGHT / 2 + 8)">N</span>
        <button
          v-for="l of labels"
          :key="`label-${l.key}`"
          type="button"
          class="cal-link-button cal-transfer-rose-label"
          :class="{ 'cal-transfer-rose-label-left': l.left, 'cal-transfer-rose-label-faded': involved && !involved.has(l.key) }"
          :style="at(l.left ? -LABEL_X : LABEL_X, l.labelY)"
          @click="toggleFlows(placeFlows(l.key).flows)"
          @mouseenter="hover = { kind: 'place', id: l.key }"
          @mouseleave="hover = undefined"
        >
          {{ l.name }}
        </button>
      </div>
      <!-- The how-to-read text sets the caption's height and stays in place,
           hidden, under a hover's or highlight's text, so the page keeps its
           height as the text changes. A longer text is cut short at the
           how-to-read text's last line. -->
      <figcaption class="is-relative mt-1 has-text-grey">
        <div ref="held" :class="{ 'is-invisible': captionText }">
          Each band joins an origin of arriving trips to a destination of
          departing trips, as wide as the connections the schedule offers
          between them, not riders.
          <cat-tooltip text="Places sit in their direction from the stops; distance is on a log scale, and crowded places are spread apart. Hover a place or band for its counts.">
            <cat-icon icon="information" /><span class="is-sr-only">How to read the compass</span>
          </cat-tooltip>
          Check rows, or click a place or band, to highlight their flows.
        </div>
        <div v-if="captionText" class="cal-transfer-rose-caption" :style="{ WebkitLineClamp: captionLines }">
          {{ captionText }}
        </div>
      </figcaption>
    </figure>

    <!-- The flows from either end, each row checked to highlight its flows.
         Only a trip pair's row shows waits by grade, as waits pooled over
         pairs describe no rider's trip. -->
    <div class="column cal-transfer-rose-list">
      <div class="is-flex is-flex-wrap-wrap is-align-items-flex-end is-justify-content-space-between is-gap-2 mb-2">
        <cat-fieldset label="Group by">
          <cat-tabs v-model="groupBy" type="toggle" class="cal-transfer-rose-group">
            <cat-tab-item value="from" label="From" />
            <cat-tab-item value="to" label="To" />
          </cat-tabs>
        </cat-fieldset>
        <span>
          <span class="has-text-grey">Highlight</span>
          <button type="button" class="cal-link-button ml-2" @click="checked = new Set(rose.flows.map(flowKey))">All</button>
          <button type="button" class="cal-link-button ml-2" @click="checked = new Set()">None</button>
        </span>
      </div>
      <div class="cal-transfer-rose-table" role="table" :aria-label="groupBy === 'from' ? 'Connections by origin' : 'Connections by destination'">
        <div class="cal-transfer-rose-row cal-transfer-rose-head has-text-weight-semibold" role="row">
          <span role="columnheader">{{ groupBy === 'from' ? 'From / arriving trip / departing trip' : 'To / departing trip / arriving trip' }}</span>
          <span role="columnheader" class="has-text-right">Connections</span>
          <span role="columnheader">By wait</span>
          <span role="columnheader" class="has-text-centered">View</span>
        </div>
        <div
          v-for="row of rows"
          :key="row.id"
          role="row"
          class="cal-transfer-rose-row"
          :class="{ 'has-text-weight-semibold': row.depth === 0, 'cal-transfer-rose-hovered': hoveredKeys.size > 0 && row.flows.every(f => hoveredKeys.has(flowKey(f))) }"
          @mouseenter="hover = { kind: 'row', id: row.id }"
          @mouseleave="hover = undefined"
        >
          <span role="cell" class="is-flex is-align-items-center is-gap-2 cal-transfer-rose-name" :class="{ 'pl-5': row.depth === 1, 'pl-6': row.depth === 2 }">
            <button
              v-if="row.shows"
              type="button"
              class="cal-link-button cal-transfer-rose-caret"
              :aria-expanded="opened.has(row.id)"
              :aria-label="`${opened.has(row.id) ? 'Hide' : 'Show'} ${row.shows}`"
              @click="toggleOpen(row.id)"
            >
              <cat-icon size="small" :icon="opened.has(row.id) ? 'chevron-down' : 'chevron-right'" />
            </button>
            <span v-else class="cal-transfer-rose-caret" />
            <cat-checkbox
              class="cal-transfer-rose-check"
              :model-value="row.state !== 'none'"
              :indeterminate="row.state === 'some'"
              @update:model-value="setChecked(row.flows, !!$event)"
            >
              <cal-route-badge v-if="row.route" :label="row.route" :title="row.agency" truncate />
              <span class="cal-transfer-rose-clip" :title="row.label">{{ row.label }}</span>
              <span v-if="row.place" class="cal-transfer-rose-clip has-text-grey has-text-weight-normal" :title="row.place">{{ groupBy === 'from' ? 'to' : 'from' }} {{ row.place }}</span>
            </cat-checkbox>
            <button type="button" class="cal-link-button is-flex-shrink-0 cal-transfer-rose-only" @click="checked = new Set(row.flows.map(flowKey))">
              Only
            </button>
          </span>
          <template v-if="row.total !== undefined">
            <span role="cell" class="has-text-right">{{ row.total.toLocaleString() }}</span>
            <span role="cell">
              <cat-tooltip v-if="row.grades" :text="gradesText(row.grades)" class="cal-transfer-rose-bar">
                <span
                  v-for="g of TRANSFER_GRADES"
                  :key="g"
                  :style="{ flexGrow: row.grades[g], background: TRANSFER_GRADE_COLORS[g].fill }"
                />
              </cat-tooltip>
            </span>
            <span role="cell" class="has-text-centered">
              <cat-tooltip text="Show in Individual">
                <button type="button" class="cal-link-button px-1" aria-label="Show in Individual" @click="show(row)">
                  <cat-icon size="small" icon="table-arrow-right" />
                </button>
              </cat-tooltip>
            </span>
          </template>
          <template v-else>
            <span role="cell" /><span role="cell" /><span role="cell" />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useElementSize } from '@vueuse/core'
import { TRANSFER_PICKED_COLOR, TRANSFER_UNPICKED_COLOR, escapeHtml, groupBy as groupByKey } from '~~/src/core'
import {
  TRANSFER_GRADES,
  TRANSFER_GRADE_COLORS,
  TRANSFER_GRADE_LABELS,
  along,
  columnLabels,
  compassRings,
  compassScale,
  quietBearing,
  spreadBearings,
  type TransferFocus,
  type TransferGradeCounts,
  type TransferRose,
  type TransferRoseFlow,
  type TransferRoseTrip,
} from '~~/src/scenario'
import { useDrawingText } from '~/composables/useDrawingText'

const props = defineProps<{
  rose: TransferRose
  // Whether trip details are still loading, and with them connections.
  loading: boolean
}>()

const emit = defineEmits<{
  // Narrow the trip filters to a focus and show Individual; `what` names
  // the focus for the toast.
  show: [focus: TransferFocus, what: string]
}>()

const uid = useId()
const WIDTH = 680
const HEIGHT = 420
// Places lie between these radii, by distance on a log scale.
const INNER = 70
const OUTER = 175
// The busiest place's bands, side by side, about this wide.
const MOST_WIDTH = 44
// Places at least this many degrees apart.
const MIN_SPREAD = 10
// Labels line up this far either side of the middle, clear of every bar,
// each at most as wide as the room left before the frame's edge.
const LABEL_X = OUTER + 8
const LABEL_ROOM = WIDTH / 2 - LABEL_X - 8
const labelRoom = `${(LABEL_ROOM / WIDTH) * 100}%`
// An arrowhead's tip lies this many band widths past its band's end, as the
// marker is 1.4 widths long and centered on the end.
const ARROW_TIP = 0.7
// One neutral color for every band, as a color per pair would suggest a
// meaning; the accent marks highlighted flows.
const COLORS = { band: TRANSFER_UNPICKED_COLOR, accent: TRANSFER_PICKED_COLOR }
// The bands' opacity: plain, faded behind a highlight, and highlighted; and
// the labels' outside a highlight.
const OPACITY = { band: 0.35, faded: 0.04, strong: 0.9, label: 0.35 }
// The light theme's text, weak text, and border colors, for the download,
// which is drawn on white.
const PRINT = { text: '#404654', weak: '#69748c', border: '#d6d9e0' }

const frame = ref<HTMLElement>()
const text = useDrawingText(frame, WIDTH)

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

// Band width per connection: the busiest place's bands, side by side, span
// MOST_WIDTH, or a little more where some are drawn at their least width.
const scale = computed(() => MOST_WIDTH / Math.max(1, ...props.rose.places.map(p => p.total)))

// Each place pair's flows as one band, as wide as its connections and never
// under a unit.
const pairs = computed(() => byTotal(props.rose.flows, f => `${f.from}>${f.to}`)
  .map(({ key, flows, total }) => ({ id: `pair:${key}`, from: flows[0]!.from, to: flows[0]!.to, flows, width: Math.max(1, total * scale.value) })))

// Places on the rose: where each lies, and its bar, which spans its bands
// side by side.
const placed = computed(() => {
  const spans = new Map<string, number>()
  for (const f of pairs.value) {
    spans.set(f.from, (spans.get(f.from) ?? 0) + f.width)
    spans.set(f.to, (spans.get(f.to) ?? 0) + f.width)
  }
  const angles = spreadBearings(props.rose.places.map(p => p.bearing), MIN_SPREAD)
  return props.rose.places.map((p, i) => {
    const angle = angles[i]!
    const [ux, uy] = along(angle)
    const r = radius(p.km)
    const span = spans.get(p.key) ?? 0
    const half = Math.max(2, span / 2)
    const [tx, ty] = [-uy, ux]
    const x = ux * r
    const y = uy * r
    return { ...p, angle, r, x, y, span, port: { x1: x - tx * half, y1: y - ty * half, x2: x + tx * half, y2: y + ty * half } }
  })
})

// The labels, in a column either side of the drawing, each as level with its
// bar as the others allow. Where a column runs out of room, the places with
// the fewest connections go unlabeled.
const labels = computed(() => {
  const { row } = text.value
  return [true, false].flatMap((left) => {
    const side = placed.value.filter(p => (p.x < 0) === left)
    const ys = columnLabels(side.map(p => ({ y: p.y, weight: p.total })), -HEIGHT / 2 + row / 2, HEIGHT / 2 - row / 2, row)
    return side.flatMap((p, i) => {
      const labelY = ys[i]
      if (labelY === undefined) {
        return []
      }
      const [ux, uy] = along(p.angle)
      const leader = { x1: ux * (p.r + 3), y1: uy * (p.r + 3), x2: left ? 2 - LABEL_X : LABEL_X - 2, y2: labelY }
      return [{ ...p, left, labelY, leader }]
    })
  })
})

// Each place pair as one curve from its origin's bar, by the stops, to its
// destination's. Every band end at a bar takes its slot by where its other
// end lies around the circle, so bands sharing a bar don't cross there; at a
// tie, a band leaving comes before one arriving.
const drawn = computed(() => {
  const at = new Map(placed.value.map(p => [p.key, p]))
  // The other end's angle, clockwise from this end's.
  const turn = (place: string, other: string) => (((at.get(other)!.angle - at.get(place)!.angle) % 360) + 360) % 360
  const ends = [
    ...pairs.value.map(f => ({ f, place: f.from, other: f.to, leaving: true })),
    ...pairs.value.map(f => ({ f, place: f.to, other: f.from, leaving: false })),
  ].sort((a, b) => turn(b.place, b.other) - turn(a.place, a.other) || Number(b.leaving) - Number(a.leaving))
  // Each end's offset along its bar, the bands side by side across its
  // middle.
  const used = new Map<string, number>()
  const starts = new Map<string, number>()
  const stops = new Map<string, number>()
  for (const { f, place, leaving } of ends) {
    const before = used.get(place) ?? 0
    used.set(place, before + f.width)
    const offset = before + f.width / 2 - at.get(place)!.span / 2
    if (leaving) {
      starts.set(f.id, offset)
    } else {
      stops.set(f.id, offset)
    }
  }
  return pairs.value.map((f) => {
    const a = at.get(f.from)!
    const b = at.get(f.to)!
    const point = (p: typeof a, o: number, k: number): [number, number] => {
      const [ux, uy] = along(p.angle)
      return [ux * p.r * k - uy * o, uy * p.r * k + ux * o]
    }
    const start = starts.get(f.id)!
    const stop = stops.get(f.id)!
    // Through the stops: drawn in close to them from either end.
    const s = point(a, start, 1)
    const c1 = point(a, start * 0.3, 0.08)
    const c2 = point(b, stop * 0.3, 0.08)
    // Short of the bar by as far as the arrowhead reaches, and a little more.
    const e = point(b, stop, 1 - (ARROW_TIP * f.width + 2) / b.r)
    const n = (v: number) => v.toFixed(1)
    return { ...f, d: `M${n(s[0])},${n(s[1])} C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(e[0])},${n(e[1])}` }
  })
})

// A flow's identity by its trip pair, which holds as the flows are rebuilt
// when trip details arrive or settings change.
function flowKey (f: TransferRoseFlow): string {
  return `${f.fromKey}\u0000${f.toKey}`
}
// The flows highlighted by checking rows or clicking places and bands.
const checked = ref(new Set<string>())
const checkedFlows = computed(() => props.rose.flows.filter(f => checked.value.has(flowKey(f))))
// What's under the pointer, by id: a band (its place pair), a place, or a
// row. Its flows and text are read from the rose as it stands, so they hold
// as the rose is rebuilt.
const hover = ref<{ kind: 'band' | 'place' | 'row', id: string }>()
const hovered = computed((): { flows: TransferRoseFlow[], text: string } | undefined => {
  const h = hover.value
  if (h?.kind === 'band') {
    const band = pairs.value.find(f => f.id === h.id)
    return band && { flows: band.flows, text: bandText(band) }
  }
  if (h?.kind === 'place') {
    const { from, flows } = placeFlows(h.id)
    return flows.length > 0 ? { flows, text: placeText(h.id, from, flows) } : undefined
  }
  const row = h && rows.value.find(r => r.id === h.id)
  return row && { flows: row.flows, text: row.text }
})
const hoveredKeys = computed(() => new Set(hovered.value?.flows.map(flowKey)))
// The flows to emphasize: those under the pointer, else those highlighted.
const emphasis = computed(() => {
  if (hovered.value) {
    return new Set(hovered.value.flows)
  }
  return checkedFlows.value.length > 0 ? new Set(checkedFlows.value) : undefined
})
// The places the emphasis touches, and each place pair's accent width, kept
// apart from the layout, which a hover leaves alone.
const involved = computed(() => emphasis.value && new Set([...emphasis.value].flatMap(f => [f.from, f.to])))
const emphasized = computed(() => {
  const totals = new Map<string, number>()
  for (const f of emphasis.value ?? []) {
    const id = `pair:${f.from}>${f.to}`
    totals.set(id, (totals.get(id) ?? 0) + f.total)
  }
  return new Map([...totals].map(([id, total]) => [id, Math.max(1, total * scale.value)]))
})
// The caption's text over the how-to-read text: the hover's, else the
// highlighted flows'.
const captionText = computed(() => hovered.value?.text ?? (checkedFlows.value.length > 0 ? `Highlighted: ${flowsText(checkedFlows.value)}` : undefined))
// The how-to-read text's lines: a longer caption is cut short at that many.
// Its info icon makes one line a little taller, so the count rounds down.
const held = ref<HTMLElement>()
const { height: heldHeight } = useElementSize(held)
const captionLines = computed(() => {
  const line = held.value ? Number.parseFloat(getComputedStyle(held.value).lineHeight) : 0
  return line > 0 ? Math.max(1, Math.floor(heldHeight.value / line)) : 1
})

function setChecked (flows: TransferRoseFlow[], on: boolean) {
  const next = new Set(checked.value)
  for (const f of flows) {
    if (on) {
      next.add(flowKey(f))
    } else {
      next.delete(flowKey(f))
    }
  }
  checked.value = next
}

// How many of the flows are highlighted: all, some or none.
function stateOf (flows: TransferRoseFlow[]): 'all' | 'some' | 'none' {
  const n = flows.filter(f => checked.value.has(flowKey(f))).length
  return n === 0 ? 'none' : n === flows.length ? 'all' : 'some'
}

// A place or band clicked on the rose: its flows checked where none were,
// else unchecked, as a row's checkbox does; and the table's groups that hold
// them opened.
function toggleFlows (flows: TransferRoseFlow[]) {
  setChecked(flows, stateOf(flows) === 'none')
  const ids = flows.map(f => groupId(groupBy.value === 'from' ? f.from : f.to)).filter(id => !opened.value.has(id))
  if (ids.length > 0) {
    opened.value = new Set([...opened.value, ...ids])
  }
}

// Shows a row's trips in Individual, as Summary's rows do: a trip pair's
// arrivals and connections; or a place's arrivals, or connections onto its
// departures.
function show (row: Row) {
  const f = row.flows[0]!
  if (row.depth === 2) {
    emit('show', { from: [f.fromKey], to: [f.toKey] }, `arrivals on ${tripName(props.rose.from.get(f.fromKey))} and connections onto ${tripName(props.rose.to.get(f.toKey))}`)
    return
  }
  const place = placesByKey.value.get(groupBy.value === 'from' ? f.from : f.to)!
  if (groupBy.value === 'from') {
    emit('show', { from: place.fromKeys }, `arrivals from ${place.name}`)
  } else {
    emit('show', { to: place.toKeys }, `connections onto departures toward ${place.name}`)
  }
}

// A place's flows on the table's grouping side, else the other side, and
// which side holds them: from the place, or toward the place.
function placeFlows (key: string): { from: boolean, flows: TransferRoseFlow[] } {
  const way = (from: boolean) => props.rose.flows.filter(f => (from ? f.from : f.to) === key)
  const from = groupBy.value === 'from'
  const flows = way(from)
  return flows.length > 0 ? { from, flows } : { from: !from, flows: way(!from) }
}

const placesByKey = computed(() => new Map(props.rose.places.map(p => [p.key, p])))
function nameOf (key: string): string {
  return placesByKey.value.get(key)?.name ?? key
}

function tripName (trip: TransferRoseTrip | undefined): string {
  return `${trip?.route ?? ''} ${trip?.label ?? ''}`.trim()
}

function totalOf (flows: TransferRoseFlow[]): number {
  return flows.reduce((n, f) => n + f.total, 0)
}

function connections (n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'connection' : 'connections'}`
}

function gradesText (grades: TransferGradeCounts): string {
  return TRANSFER_GRADES.filter(g => grades[g] > 0).map(g => `${grades[g].toLocaleString()} ${TRANSFER_GRADE_LABELS[g].toLowerCase()}`).join(', ')
}

// Flows as text: one trip pair with its waits by grade; several, their
// connections and how many pairs, as waits pooled over pairs describe no
// rider's trip.
function flowsText (flows: TransferRoseFlow[]): string {
  return flows.length === 1
    ? flowText(flows[0]!)
    : `${connections(totalOf(flows))} across ${flows.length.toLocaleString()} trip pairs.`
}

// The counts lead, so a caption cut short still shows the counts.
function flowText (f: TransferRoseFlow): string {
  return `${connections(f.total)} (${gradesText(f.grades)}), arriving on ${tripName(props.rose.from.get(f.fromKey))} from ${nameOf(f.from)} and leaving on ${tripName(props.rose.to.get(f.toKey))} toward ${nameOf(f.to)}.`
}

function placeText (key: string, from: boolean, flows: TransferRoseFlow[]): string {
  return `${from ? 'From' : 'To'} ${nameOf(key)}: ${flowsText(flows)}`
}

// A band's flows, between its two places.
function bandText (f: { from: string, to: string, flows: TransferRoseFlow[] }): string {
  return f.flows.length === 1 ? flowText(f.flows[0]!) : `From ${nameOf(f.from)} to ${nameOf(f.to)}: ${flowsText(f.flows)}`
}

const groupBy = ref<'from' | 'to'>('from')
const opened = ref(new Set<string>())
function toggleOpen (id: string) {
  const next = new Set(opened.value)
  if (!next.delete(id)) {
    next.add(id)
  }
  opened.value = next
}

// A place's group in the table, as now grouped.
function groupId (place: string): string {
  return `${groupBy.value}:${place}`
}

interface Row {
  id: string
  depth: number
  label: string
  route?: string
  agency?: string
  place?: string
  flows: TransferRoseFlow[]
  state: 'all' | 'some' | 'none'
  text: string
  // What its caret shows, for a row with one.
  shows?: string
  // A place's or trip pair's connections, and a trip pair's waits by grade.
  total?: number
  grades?: TransferGradeCounts
}

// Flows grouped, by most connections.
function byTotal<K> (flows: TransferRoseFlow[], keyOf: (f: TransferRoseFlow) => K) {
  return [...groupByKey(flows, keyOf)]
    .map(([key, list]) => ({ key, flows: list, total: totalOf(list) }))
    .sort((a, b) => b.total - a.total)
}

// The table's rows, grouped from where trips start or where they end: each
// place, by most connections; under it, when opened, its trips that way; and
// under each, when opened, the trips paired with it the other way.
const rows = computed((): Row[] => {
  const from = groupBy.value === 'from'
  const placeOf = (f: TransferRoseFlow) => (from ? f.from : f.to)
  const otherPlaceOf = (f: TransferRoseFlow) => (from ? f.to : f.from)
  const keyOf = (f: TransferRoseFlow) => (from ? f.fromKey : f.toKey)
  const otherKeyOf = (f: TransferRoseFlow) => (from ? f.toKey : f.fromKey)
  const near = from ? props.rose.from : props.rose.to
  const far = from ? props.rose.to : props.rose.from
  return byTotal(props.rose.flows, placeOf).flatMap(({ key: place, flows, total }) => {
    const id = groupId(place)
    const row: Row = { id, depth: 0, label: nameOf(place), flows, state: stateOf(flows), text: placeText(place, from, flows), shows: `trips ${from ? 'from' : 'to'} ${nameOf(place)}`, total }
    if (!opened.value.has(id)) {
      return [row]
    }
    return [row, ...byTotal(flows, keyOf).flatMap(({ key, flows: trips }) => {
      const trip = near.get(key)
      const tripId = `${id}|${key}`
      const tripRow: Row = { id: tripId, depth: 1, label: trip?.label ?? '', route: trip?.route, agency: trip?.agency, flows: trips, state: stateOf(trips), text: `${tripName(trip)} ${from ? 'from' : 'to'} ${nameOf(place)}.`, shows: `trips paired with ${tripName(trip)}` }
      if (!opened.value.has(tripId)) {
        return [tripRow]
      }
      // One flow for each trip paired with this one.
      return [tripRow, ...[...trips].sort((a, b) => b.total - a.total).map((f): Row => {
        const other = far.get(otherKeyOf(f))
        return { id: `${tripId}>${otherKeyOf(f)}`, depth: 2, label: other?.label ?? '', route: other?.route, agency: other?.agency, place: nameOf(otherPlaceOf(f)), flows: [f], state: stateOf([f]), text: flowText(f), total: f.total, grades: f.grades }
      })]
    })]
  })
})

// The rose as a standalone SVG for download, as it shows: its labels, cut
// short as the page cuts them, and any highlight, in the light theme's
// colors on white.
function toSvg (): string {
  const n = (v: number) => v.toFixed(1)
  const focused = emphasis.value
  const { size } = text.value
  const context = document.createElement('canvas').getContext('2d')
  if (context) {
    context.font = `${size}px sans-serif`
  }
  const marker = (key: keyof typeof COLORS) => `<marker id="m-${key}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="1.4" markerHeight="1.4" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${COLORS[key]}"/></marker>`
  const ribbon = (d: string, key: keyof typeof COLORS, width: number, opacity: number, arrow: boolean) =>
    `<path d="${d}" fill="none" stroke="${COLORS[key]}" stroke-width="${n(width)}" opacity="${opacity}"${arrow ? ` marker-end="url(#m-${key})"` : ''}/>`
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-WIDTH / 2} ${-HEIGHT / 2} ${WIDTH} ${HEIGHT}" width="${WIDTH * 1.5}" height="${HEIGHT * 1.5}" font-family="sans-serif" font-size="${n(size)}">`,
    `<defs>${marker('band')}${marker('accent')}</defs>`,
    `<rect x="${-WIDTH / 2}" y="${-HEIGHT / 2}" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`,
    ...rings.value.map(r => `<circle r="${n(r.r)}" fill="none" stroke="${PRINT.border}" stroke-dasharray="2 3"/><text x="${n(r.x)}" y="${n(r.y)}" text-anchor="middle" dominant-baseline="middle" font-size="8" fill="${PRINT.weak}" stroke="#ffffff" stroke-width="3" paint-order="stroke">${r.km} km</text>`),
    ...labels.value.map(({ leader: l }) => `<line x1="${n(l.x1)}" y1="${n(l.y1)}" x2="${n(l.x2)}" y2="${n(l.y2)}" stroke="${PRINT.border}" stroke-width="0.75"/>`),
    ...drawn.value.flatMap(f => [
      ribbon(f.d, 'band', f.width, focused ? OPACITY.faded : OPACITY.band, !focused),
      ...(emphasized.value.has(f.id) ? [ribbon(f.d, 'accent', emphasized.value.get(f.id)!, OPACITY.strong, true)] : []),
    ]),
    ...placed.value.map(p => `<line x1="${n(p.port.x1)}" y1="${n(p.port.y1)}" x2="${n(p.port.x2)}" y2="${n(p.port.y2)}" stroke="${PRINT.text}" stroke-width="3" stroke-linecap="round"/>`),
    ...(placed.value.length > 0 ? [`<circle r="5" fill="${PRINT.text}"/>`] : []),
    `<text x="0" y="${-HEIGHT / 2 + 8}" dy="0.35em" text-anchor="middle" font-weight="600" fill="${PRINT.weak}">N</text>`,
    ...labels.value.map((l) => {
      const faded = involved.value && !involved.value.has(l.key) ? ` opacity="${OPACITY.label}"` : ''
      return `<text x="${l.left ? -LABEL_X : LABEL_X}" y="${n(l.labelY)}" dy="0.35em" text-anchor="${l.left ? 'end' : 'start'}" fill="${PRINT.text}"${faded}>${escapeHtml(fitName(l.name, context))}</text>`
    }),
    '</svg>',
  ]
  return parts.join('')
}

// A name cut short with an ellipsis to the labels' room, measured in the
// download's font.
function fitName (name: string, context: CanvasRenderingContext2D | null): string {
  if (!context || context.measureText(name).width <= LABEL_ROOM) {
    return name
  }
  let cut = name
  while (cut.length > 0 && context.measureText(`${cut}…`).width > LABEL_ROOM) {
    cut = cut.slice(0, -1)
  }
  return `${cut.trimEnd()}…`
}

defineExpose({ toSvg })

// A point in SVG coordinates as a CSS position over the frame.
function at (x: number, y: number) {
  return { left: `${((x + WIDTH / 2) / WIDTH) * 100}%`, top: `${((y + HEIGHT / 2) / HEIGHT) * 100}%` }
}
</script>

<style scoped lang="scss">
// The table's column shrinks with the report, cutting its rows short.
.cal-transfer-rose-list {
  min-width: 0;
}

// Ring labels stay small enough to fit between the rings, which lie closer
// together than a line of text.
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

.cal-transfer-rose-leader {
  stroke: var(--bulma-border);
  stroke-width: 0.75;
}

.cal-transfer-rose-flow {
  fill: none;
  opacity: v-bind('OPACITY.band');
  cursor: pointer;
  transition: opacity 0.15s;
}

.cal-transfer-rose-faded {
  opacity: v-bind('OPACITY.faded');
}

// Over its band, which takes the pointer.
.cal-transfer-rose-strong {
  opacity: v-bind('OPACITY.strong');
  pointer-events: none;
}

// The north mark and place labels over the drawing: the mark centered on its
// spot, and a label in its column, within the room between the outer ring
// and the frame's edge.
.cal-transfer-rose-north,
.cal-transfer-rose-label {
  position: absolute;
  line-height: 1;
  white-space: nowrap;
}

.cal-transfer-rose-north {
  transform: translate(-50%, -50%);
}

.cal-transfer-rose-label {
  max-width: v-bind(labelRoom);
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateY(-50%);
}

.cal-transfer-rose-label-left {
  transform: translate(-100%, -50%);
}

.cal-transfer-rose-label-faded {
  opacity: v-bind('OPACITY.label');
}

// A hover's or highlight's text over the how-to-read text, from its top, cut
// short with an ellipsis at the lines set inline.
.cal-transfer-rose-caption {
  position: absolute;
  inset: 0 0 auto;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cal-transfer-rose-group {
  --bulma-block-spacing: 0;
}

// Rows share the table's columns, so their cells line up; the header pins to
// the page as the table scrolls past.
.cal-transfer-rose-table {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(3, max-content);
  column-gap: 0.75rem;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
}

.cal-transfer-rose-row {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: center;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--bulma-border-weak);
}

.cal-transfer-rose-head {
  position: sticky;
  top: 0;
  z-index: 1;
  border-top: 0;
  background: var(--bulma-scheme-main-ter);
}

.cal-transfer-rose-hovered {
  background: color-mix(in srgb, v-bind('COLORS.accent') 15%, transparent);
}

.cal-transfer-rose-name,
.cal-transfer-rose-check {
  min-width: 0;
}

// A caret's room, kept on a row without one, so the rows line up.
.cal-transfer-rose-caret {
  flex: 0 0 1.25rem;
}

.cal-transfer-rose-clip {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// A row's Only link, shown as the row is hovered or the link focused.
.cal-transfer-rose-only {
  opacity: 0;

  .cal-transfer-rose-row:hover &,
  &:focus-visible {
    opacity: 1;
  }
}

// Sized like Summary's share track.
.cal-transfer-rose-bar {
  display: flex;
  width: 4rem;
  height: 0.5rem;
  border-radius: 999px;
  overflow: hidden;
  background: var(--bulma-scheme-main-ter);

  > span {
    flex-basis: 0;
  }
}
</style>
