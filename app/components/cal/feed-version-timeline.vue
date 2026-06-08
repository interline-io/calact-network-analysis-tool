<template>
  <div
    ref="rootEl"
    class="cal-fv-timeline"
    role="img"
    :aria-label="`Service intensity from ${domainStartIso} to ${domainEndIso}`"
  >
    <div
      v-if="displayRect"
      class="cal-fv-timeline-window"
      :class="{ 'is-editable': editable, 'is-dragging': dragMode !== null }"
      :style="{ left: displayRect.left, width: displayRect.width }"
      :tabindex="editable ? 0 : undefined"
      :role="editable ? 'slider' : undefined"
      :aria-label="editable ? 'Analysis window — drag to move, drag edges to resize, arrow keys to nudge (Shift+arrow resizes), or use the date pickers above' : undefined"
      :aria-valuemin="editable ? domainStartOrd : undefined"
      :aria-valuemax="editable ? domainEndOrd : undefined"
      :aria-valuenow="editable ? analysisStartOrd ?? undefined : undefined"
      :aria-valuetext="editable ? `${analysisStartIso} to ${analysisEndIso}` : undefined"
      @keydown="onWindowKeydown"
    >
      <template v-if="editable">
        <div
          class="cal-fv-timeline-window-handle is-left"
          @pointerdown="onPointerDown($event, 'resize-left')"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
        <div
          class="cal-fv-timeline-window-move"
          @pointerdown="onPointerDown($event, 'move')"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
        <div
          class="cal-fv-timeline-window-handle is-right"
          @pointerdown="onPointerDown($event, 'resize-right')"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        />
      </template>
    </div>

    <!-- Coverage stripe keeps the FV range visible even when service_levels is empty. -->
    <div
      v-if="coverageRect"
      class="cal-fv-timeline-coverage"
      :style="{ left: coverageRect.left, width: coverageRect.width }"
    />

    <div class="cal-fv-timeline-cells">
      <div
        v-for="cell in dayCells"
        :key="cell.iso"
        class="cal-fv-timeline-day"
        :class="{ 'is-outside-feed-info': cell.outsideFeedInfo }"
        :style="{ backgroundColor: cell.color }"
        :title="cell.tooltip"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  isoToOrdinal,
  maxServiceSecondsPerDay,
  ordinalToIso,
  SERVICE_LEVEL_DAY_COLS,
  type FeedVersionServiceLevelRow,
} from '~~/src/tl'
import { asDateString } from '~~/src/core'

const SERVICE_BUCKETS = 10

const props = defineProps<{
  serviceLevels: FeedVersionServiceLevelRow[]
  domainStart: Date | string
  domainEnd: Date | string
  analysisStart?: Date | string | null
  analysisEnd?: Date | string | null
  // Feed-scoped ceiling so per-FV cells share the same opacity scale.
  maxDaySeconds?: number
  earliestCalendarDate?: string | null
  latestCalendarDate?: string | null
  feedInfoStartDate?: string | null
  feedInfoEndDate?: string | null
  // When true (picker modal context), the analysis window becomes a
  // drag-to-move / drag-edges-to-resize control that emits date updates.
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:analysisRange', value: { start: string, end: string }): void
}>()

// asDateString handles both Date and 'YYYY-MM-DD' string inputs without
// the local-vs-UTC drift that bit the previous SVG version.
function toIso (v: Date | string | null | undefined): string | null {
  if (v == null) { return null }
  return asDateString(v) ?? null
}

const domainStartIso = computed(() => toIso(props.domainStart) ?? '')
const domainEndIso = computed(() => toIso(props.domainEnd) ?? '')

const domainStartOrd = computed(() => isoToOrdinal(domainStartIso.value))
const domainEndOrd = computed(() => isoToOrdinal(domainEndIso.value))
const domainDays = computed(() => Math.max(1, domainEndOrd.value - domainStartOrd.value + 1))

const earliestOrd = computed<number | null>(() => {
  const iso = toIso(props.earliestCalendarDate ?? null)
  return iso ? isoToOrdinal(iso) : null
})
const latestOrd = computed<number | null>(() => {
  const iso = toIso(props.latestCalendarDate ?? null)
  return iso ? isoToOrdinal(iso) : null
})

// Rows can span multiple weeks; day columns repeat across the [start, end] span.
const dailySeconds = computed<Map<string, number>>(() => {
  const out = new Map<string, number>()
  for (const r of props.serviceLevels || []) {
    const startIso = toIso(r.start_date)
    const endIso = toIso(r.end_date)
    if (!startIso || !endIso) { continue }
    const startOrd = isoToOrdinal(startIso)
    const endOrd = isoToOrdinal(endIso)
    let weekday = (new Date(startOrd * 86_400_000).getUTCDay() + 6) % 7
    for (let ord = startOrd; ord <= endOrd; ord++) {
      out.set(ordinalToIso(ord), (r[SERVICE_LEVEL_DAY_COLS[weekday]!] as number) ?? 0)
      weekday = (weekday + 1) % 7
    }
  }
  return out
})

interface DayCell { iso: string, color: string, tooltip: string, outsideFeedInfo: boolean }

const dayCells = computed<DayCell[]>(() => {
  const max = props.maxDaySeconds && props.maxDaySeconds > 0
    ? props.maxDaySeconds
    : maxServiceSecondsPerDay(props.serviceLevels)

  const cells: DayCell[] = []
  for (let i = 0; i < domainDays.value; i++) {
    const ord = domainStartOrd.value + i
    const iso = ordinalToIso(ord)
    const inCoverage = isInCoverage(ord)
    const outsideFeedInfo = isOutsideFeedInfo(ord)
    const seconds = dailySeconds.value.get(iso) ?? 0
    let color: string
    let tooltip: string
    if (!inCoverage) {
      color = 'transparent'
      tooltip = `${iso} — outside feed version coverage`
    } else if (max <= 0) {
      // No service_levels rows (typically a not-yet-imported FV).
      color = 'transparent'
      tooltip = `${iso} — no service data`
    } else if (seconds <= 0) {
      color = 'rgba(29, 111, 184, 0.08)'
      tooltip = `${iso} — no scheduled service`
    } else {
      // Quantize into N buckets so visually close days read as the same shade.
      const intensity = Math.min(1, seconds / max)
      const bucket = Math.min(SERVICE_BUCKETS, Math.max(1, Math.ceil(intensity * SERVICE_BUCKETS)))
      const opacity = bucket / SERVICE_BUCKETS
      color = `rgba(29, 111, 184, ${opacity.toFixed(2)})`
      const hours = (seconds / 3600).toFixed(1)
      const maxHours = (max / 3600).toFixed(1)
      const pct = Math.round(intensity * 100)
      tooltip = `${iso}\n${hours} h (${pct}% of max)\nFeed max: ${maxHours} h`
    }
    if (outsideFeedInfo) {
      tooltip += '\nOutside feed_info.txt validity'
    }
    cells.push({ iso, color, tooltip, outsideFeedInfo })
  }
  return cells
})

function isInCoverage (ord: number): boolean {
  const lo = earliestOrd.value
  const hi = latestOrd.value
  if (lo == null && hi == null) { return true }
  if (lo != null && ord < lo) { return false }
  if (hi != null && ord > hi) { return false }
  return true
}

function pct (n: number): string {
  return `${(n * 100).toFixed(4)}%`
}

function ordToPct (ord: number): number {
  return (ord - domainStartOrd.value) / domainDays.value
}

const analysisStartIso = computed(() => toIso(props.analysisStart ?? null))
const analysisEndIso = computed(() => toIso(props.analysisEnd ?? null))
const analysisStartOrd = computed<number | null>(() =>
  analysisStartIso.value ? isoToOrdinal(analysisStartIso.value) : null)
const analysisEndOrd = computed<number | null>(() =>
  analysisEndIso.value ? isoToOrdinal(analysisEndIso.value) : null)

function rectForOrds (startOrd: number, endOrd: number) {
  const p1 = ordToPct(startOrd)
  const p2 = ordToPct(endOrd + 1)
  if (p2 <= 0 || p1 >= 1) { return null }
  const left = Math.max(0, p1)
  const right = Math.min(1, p2)
  return { left: pct(left), width: pct(Math.max(0.001, right - left)) }
}

const analysisRect = computed(() => {
  if (analysisStartOrd.value == null || analysisEndOrd.value == null) { return null }
  return rectForOrds(analysisStartOrd.value, analysisEndOrd.value)
})

// --- Drag-to-edit analysis window (editable mode) ---

type DragMode = 'move' | 'resize-left' | 'resize-right'

const rootEl = ref<HTMLElement | null>(null)
const dragMode = ref<DragMode | null>(null)
// Window ordinals while a drag is in flight — rendering from these keeps the
// overlay glued to the pointer instead of waiting for the staged props to
// round-trip through the parent.
const dragStartOrd = ref<number | null>(null)
const dragEndOrd = ref<number | null>(null)
let dragAnchorOrd = 0
let dragInitStartOrd = 0
let dragInitEndOrd = 0
let rafId: number | null = null
// Cached at pointerdown — the root's geometry can't change mid-drag (pointer
// captured, static layout), so we avoid a getBoundingClientRect() reflow on
// every pointermove.
let dragRect: DOMRect | null = null

const displayRect = computed(() => {
  if (dragMode.value !== null && dragStartOrd.value != null && dragEndOrd.value != null) {
    return rectForOrds(dragStartOrd.value, dragEndOrd.value)
  }
  return analysisRect.value
})

function clampOrd (ord: number): number {
  return Math.min(domainEndOrd.value, Math.max(domainStartOrd.value, ord))
}

// Day under the pointer, clamped to the visible domain.
function ordAtPointer (clientX: number): number {
  const rect = dragRect ?? rootEl.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0) { return domainStartOrd.value }
  const frac = (clientX - rect.left) / rect.width
  return clampOrd(domainStartOrd.value + Math.floor(frac * domainDays.value))
}

function onPointerDown (e: PointerEvent, mode: DragMode) {
  if (!props.editable || analysisStartOrd.value == null || analysisEndOrd.value == null) { return }
  e.preventDefault()
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  dragRect = rootEl.value?.getBoundingClientRect() ?? null
  dragMode.value = mode
  dragAnchorOrd = ordAtPointer(e.clientX)
  dragInitStartOrd = analysisStartOrd.value
  dragInitEndOrd = analysisEndOrd.value
  dragStartOrd.value = dragInitStartOrd
  dragEndOrd.value = dragInitEndOrd
}

function onPointerMove (e: PointerEvent) {
  if (dragMode.value === null) { return }
  const ord = ordAtPointer(e.clientX)
  if (dragMode.value === 'resize-left') {
    dragStartOrd.value = Math.min(ord, dragEndOrd.value ?? ord)
  } else if (dragMode.value === 'resize-right') {
    dragEndOrd.value = Math.max(ord, dragStartOrd.value ?? ord)
  } else {
    // Shift the whole window, preserving width, clamped inside the domain.
    const width = dragInitEndOrd - dragInitStartOrd
    let start = dragInitStartOrd + (ord - dragAnchorOrd)
    start = Math.max(domainStartOrd.value, Math.min(domainEndOrd.value - width, start))
    dragStartOrd.value = start
    dragEndOrd.value = start + width
  }
  scheduleEmit()
}

function onPointerUp (e: PointerEvent) {
  if (dragMode.value === null) { return }
  const target = e.currentTarget as HTMLElement
  target.releasePointerCapture(e.pointerId)
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  emitDragRange()
  dragMode.value = null
  dragStartOrd.value = null
  dragEndOrd.value = null
  dragRect = null
}

// rAF-throttled so a fast drag emits at most once per frame.
function scheduleEmit () {
  if (rafId != null) { return }
  rafId = requestAnimationFrame(() => {
    rafId = null
    emitDragRange()
  })
}

function emitDragRange () {
  if (dragStartOrd.value == null || dragEndOrd.value == null) { return }
  emit('update:analysisRange', {
    start: ordinalToIso(dragStartOrd.value),
    end: ordinalToIso(dragEndOrd.value),
  })
}

// Arrow keys move the window one day; Shift+arrow resizes the end edge. The
// modal's header date pickers remain the primary accessible path.
function onWindowKeydown (e: KeyboardEvent) {
  if (!props.editable || analysisStartOrd.value == null || analysisEndOrd.value == null) { return }
  const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
  if (delta === 0) { return }
  e.preventDefault()
  const start = analysisStartOrd.value
  const end = analysisEndOrd.value
  if (e.shiftKey) {
    const newEnd = Math.min(domainEndOrd.value, Math.max(start, end + delta))
    emit('update:analysisRange', { start: ordinalToIso(start), end: ordinalToIso(newEnd) })
  } else {
    const width = end - start
    const newStart = Math.max(domainStartOrd.value, Math.min(domainEndOrd.value - width, start + delta))
    emit('update:analysisRange', { start: ordinalToIso(newStart), end: ordinalToIso(newStart + width) })
  }
}

onBeforeUnmount(() => {
  if (rafId != null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

const coverageRect = computed(() => {
  if (earliestOrd.value == null || latestOrd.value == null) { return null }
  const p1 = ordToPct(earliestOrd.value)
  const p2 = ordToPct(latestOrd.value + 1)
  if (p2 <= 0 || p1 >= 1) { return null }
  const left = Math.max(0, p1)
  const right = Math.min(1, p2)
  return { left: pct(left), width: pct(Math.max(0.001, right - left)) }
})

const feedInfoStartOrd = computed<number | null>(() => {
  const iso = toIso(props.feedInfoStartDate ?? null)
  return iso ? isoToOrdinal(iso) : null
})
const feedInfoEndOrd = computed<number | null>(() => {
  const iso = toIso(props.feedInfoEndDate ?? null)
  return iso ? isoToOrdinal(iso) : null
})

function isOutsideFeedInfo (ord: number): boolean {
  const lo = feedInfoStartOrd.value
  const hi = feedInfoEndOrd.value
  if (lo == null && hi == null) { return false }
  if (lo != null && ord < lo) { return true }
  if (hi != null && ord > hi) { return true }
  return false
}
</script>

<style scoped>
.cal-fv-timeline {
  position: relative;
  width: 100%;
  height: 24px;
  background: #f4f4f4;
  border-radius: 2px;
  overflow: hidden;
}
.cal-fv-timeline-window {
  position: absolute;
  top: 0;
  bottom: 0;
  background: transparent;
  border: 2px solid #d8b440;
  /* Above the cells so the outline frames them rather than being painted over. */
  z-index: 5;
  pointer-events: none;
}
.cal-fv-timeline-window.is-editable {
  pointer-events: auto;
  display: flex;
}
.cal-fv-timeline-window.is-editable:focus-visible {
  outline: 2px solid #1d6fb8;
  outline-offset: 1px;
}
.cal-fv-timeline-window.is-dragging {
  background: rgba(216, 180, 64, 0.12);
}
.cal-fv-timeline-window-handle {
  flex: 0 0 6px;
  cursor: ew-resize;
  /* Prevent touch scrolling from hijacking the drag. */
  touch-action: none;
}
.cal-fv-timeline-window-move {
  flex: 1 1 auto;
  min-width: 0;
  cursor: grab;
  touch-action: none;
}
.is-dragging .cal-fv-timeline-window-move {
  cursor: grabbing;
}
.cal-fv-timeline-coverage {
  position: absolute;
  top: 0;
  bottom: 0;
  background: rgba(29, 111, 184, 0.06);
  border-left: 1px solid rgba(29, 111, 184, 0.4);
  border-right: 1px solid rgba(29, 111, 184, 0.4);
  z-index: 1;
}
.cal-fv-timeline-cells {
  position: absolute;
  inset: 0;
  display: flex;
  z-index: 2;
}
.cal-fv-timeline-day {
  flex: 1 1 0;
  min-width: 0;
}
.cal-fv-timeline-day.is-outside-feed-info {
  /* Hatch overlays the inline background-color (service intensity). */
  background-image: repeating-linear-gradient(
    45deg,
    #d8b440 0,
    #d8b440 1px,
    transparent 1px,
    transparent 4px
  );
}
</style>
