<template>
  <div
    class="cal-fv-timeline"
    role="img"
    :aria-label="`Service intensity from ${domainStartIso} to ${domainEndIso}`"
  >
    <!-- Analysis window highlight (behind the cells) -->
    <div
      v-if="analysisRect"
      class="cal-fv-timeline-window"
      :style="{ left: analysisRect.left, width: analysisRect.width }"
    />

    <!-- Coverage extent stripe — visible even when no service_levels rows
         exist (e.g., FV not yet imported), so the FV's date range stays
         distinguishable from siblings -->
    <div
      v-if="coverageRect"
      class="cal-fv-timeline-coverage"
      :style="{ left: coverageRect.left, width: coverageRect.width }"
    />

    <!-- Per-day cells, flex-equalized across the domain. Cells outside
         feed_info.txt's declared validity get a hatched overlay so the
         publisher's stated range stays distinguishable from the calendar
         coverage extent. -->
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
import { computed } from 'vue'
import type { FeedVersionServiceLevelRow } from '~~/src/tl'

// Number of discrete intensity buckets for daily cells. Each cell snaps to
// 1..N where N is full intensity; legend shows three representative shades.
const SERVICE_BUCKETS = 10

const props = defineProps<{
  serviceLevels: FeedVersionServiceLevelRow[]
  // The full timeline x-axis (ISO YYYY-MM-DD or Date). All FV rows in a feed
  // should share this so alignment across rows is consistent.
  domainStart: Date | string
  domainEnd: Date | string
  // The user's analysis window, overlaid as a highlighted band.
  analysisStart?: Date | string | null
  analysisEnd?: Date | string | null
  // Per-day seconds ceiling for opacity normalization. Pass the feed's
  // observed max so all FVs in the same feed share the scale.
  maxDaySeconds?: number
  // Coverage extent — cells outside this range render as fully transparent
  // so coverage differences between FVs are visible at a glance.
  earliestCalendarDate?: string | null
  latestCalendarDate?: string | null
  // feed_info.txt declared validity. When present these mark publisher intent
  // and often differ from the calendar-derived coverage extent.
  feedInfoStartDate?: string | null
  feedInfoEndDate?: string | null
}>()

// --- TZ-safe date helpers ---
// All date math here keys off the ISO YYYY-MM-DD string directly, avoiding
// the local-vs-UTC drift that bit the previous SVG version (a Date parsed
// from "2026-04-13" at midnight UTC becomes "2026-04-12" when format()-ed
// in a PST/PDT browser).
function toIso (v: Date | string | null | undefined): string | null {
  if (v == null) { return null }
  if (typeof v === 'string') {
    // Accept YYYY-MM-DD or anything starting with one; ignore the rest.
    const m = v.match(/^(\d{4}-\d{2}-\d{2})/)
    return m ? m[1]! : null
  }
  // Date input represents a local-calendar day (date-fns parseDate / subDays
  // build local-midnight Date objects). Read local components to recover the
  // calendar day the caller meant — using getUTC* shifts by ±1 day when the
  // browser is west/east of UTC.
  const y = v.getFullYear()
  const mm = String(v.getMonth() + 1).padStart(2, '0')
  const dd = String(v.getDate()).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

function isoToOrdinal (iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function ordinalToIso (ord: number): string {
  const dt = new Date(ord * 86_400_000)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

// Expand weekly service_levels rows into Map<isoDay, seconds>. Each row's
// start_date is Monday; columns are Mon..Sun seconds.
const dailySeconds = computed<Map<string, number>>(() => {
  const out = new Map<string, number>()
  for (const r of props.serviceLevels || []) {
    const startIso = toIso(r.start_date)
    if (!startIso) { continue }
    const startOrd = isoToOrdinal(startIso)
    const cols = [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday]
    for (let i = 0; i < 7; i++) {
      out.set(ordinalToIso(startOrd + i), cols[i] ?? 0)
    }
  }
  return out
})

interface DayCell { iso: string, color: string, tooltip: string, outsideFeedInfo: boolean }

const dayCells = computed<DayCell[]>(() => {
  const max = props.maxDaySeconds && props.maxDaySeconds > 0
    ? props.maxDaySeconds
    : computeMaxFromRows(props.serviceLevels)

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
      // Outside the FV's [earliest, latest] window: render nothing so
      // coverage differences between FVs are visible at a glance.
      color = 'transparent'
      tooltip = `${iso} — outside feed version coverage`
    } else if (max <= 0) {
      // No service_levels data at all (e.g. FV not imported). Don't paint a
      // cell — the coverage stripe behind already marks the extent.
      color = 'transparent'
      tooltip = `${iso} — no service data`
    } else if (seconds <= 0) {
      // In coverage with data but zero service that day (holiday / blackout).
      color = 'rgba(29, 111, 184, 0.08)'
      tooltip = `${iso} — no scheduled service`
    } else {
      // Snap to 10 discrete buckets (1..10) so cells visually quantize and
      // small differences read as the same shade.
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

function computeMaxFromRows (rows: FeedVersionServiceLevelRow[]): number {
  let max = 0
  for (const r of rows || []) {
    for (const v of [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday]) {
      if (v > max) { max = v }
    }
  }
  return max
}

function pct (n: number): string {
  return `${(n * 100).toFixed(4)}%`
}

function ordToPct (ord: number): number {
  return (ord - domainStartOrd.value) / domainDays.value
}

const analysisRect = computed(() => {
  const sIso = toIso(props.analysisStart ?? null)
  const eIso = toIso(props.analysisEnd ?? null)
  if (!sIso || !eIso) { return null }
  const p1 = ordToPct(isoToOrdinal(sIso))
  const p2 = ordToPct(isoToOrdinal(eIso) + 1)
  if (p2 <= 0 || p1 >= 1) { return null }
  const left = Math.max(0, p1)
  const right = Math.min(1, p2)
  return { left: pct(left), width: pct(Math.max(0.001, right - left)) }
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
  /* background-color stays inline (driven by service intensity); layer a
     diagonal hatch on top via background-image so the cell still reads as
     "service" but visibly outside the publisher's stated validity. */
  background-image: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.18) 0,
    rgba(0, 0, 0, 0.18) 1px,
    transparent 1px,
    transparent 4px
  );
}
</style>
