<template>
  <div class="hourly-departures-chart">
    <div class="field is-horizontal hourly-departures-date-toggles">
      <div class="field-label is-small">
        <label class="label">Filter days</label>
      </div>
      <div class="field-body">
        <div class="buttons">
          <button
            v-for="date in serviceDates"
            :key="date"
            type="button"
            class="button is-small"
            :class="activeDates.has(date) ? 'is-info' : 'is-light'"
            @click="toggleDate(date)"
          >
            {{ formatDate(date) }}
          </button>
        </div>
      </div>
    </div>

    <div class="hourly-departures-bars">
      <div
        v-for="bucket in buckets"
        :key="bucket.hour"
        class="hourly-departures-bar-group"
      >
        <cat-tooltip :text="statsTooltip">
          <div class="hourly-departures-bar-stats">
            <template v-if="bucket.total > 0">
              <span>{{ bucket.total }}</span>
              <span v-if="dayCount > 1">{{ bucket.avg }}</span>
              <span v-if="bucket.avgHeadway != null">~{{ formatDuration(Math.round(bucket.avgHeadway / 60) * 60) }}</span>
            </template>
          </div>
        </cat-tooltip>
        <div class="hourly-departures-bar-container">
          <div
            class="hourly-departures-bar"
            :style="{ height: `${bucket.barHeight}%` }"
          />
        </div>
        <div class="hourly-departures-hour-label">
          {{ bucket.label }}
        </div>
      </div>
    </div>

    <dl class="hourly-departures-totals">
      <div>
        <dt>Total departures ({{ dayCount }} days):</dt>
        <dd>{{ totals.total }} ({{ totals.avgPerDay }} per day)</dd>
      </div>
      <div>
        <dt>Total gaps ({{ dayCount }} days):</dt>
        <dd>{{ totals.gapCount }} ({{ totals.gapsPerDay }} per day)</dd>
      </div>
      <div v-if="totals.medianHeadway != null">
        <dt>Median headway:</dt>
        <dd>{{ formatGtfsTimeFull(totals.medianHeadway) }}</dd>
      </div>
      <div v-if="totals.avgHeadway != null">
        <dt>Average headway:</dt>
        <dd>{{ formatGtfsTimeFull(Math.round(totals.avgHeadway)) }}</dd>
      </div>
    </dl>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { format } from 'date-fns'
import { formatDuration, formatGtfsTimeFull } from '~~/src/core'

export interface ChartDeparture {
  serviceDate: string
  departureTime: number
  gapToNext?: number
  gapIsNoise: boolean
}

const props = defineProps<{
  departures: ChartDeparture[]
  startHour?: number
  endHour?: number
}>()

// Unique service dates in order of appearance
const serviceDates = computed(() => {
  const seen = new Set<string>()
  const dates: string[] = []
  for (const dep of props.departures) {
    if (!seen.has(dep.serviceDate)) {
      seen.add(dep.serviceDate)
      dates.push(dep.serviceDate)
    }
  }
  return dates
})

// All dates active by default
const activeDates = ref(new Set<string>())
const initializedDates = ref(false)

// Initialize active dates when service dates change
const effectiveActiveDates = computed(() => {
  if (!initializedDates.value || activeDates.value.size === 0) {
    return new Set(serviceDates.value)
  }
  return activeDates.value
})

function toggleDate (date: string) {
  initializedDates.value = true
  const next = new Set(effectiveActiveDates.value)
  if (next.has(date)) {
    if (next.size > 1) {
      next.delete(date)
    }
  } else {
    next.add(date)
  }
  activeDates.value = next
}

function formatDate (dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return format(new Date(y!, m! - 1, d!), 'EEE dd, MMM')
}

const dayCount = computed(() => Math.max(1, effectiveActiveDates.value.size))

const filteredDepartures = computed(() =>
  props.departures.filter(dep => effectiveActiveDates.value.has(dep.serviceDate)),
)

interface HourBucket {
  hour: number
  label: string
  total: number
  avg: number
  avgHeadway: number | null
  barHeight: number
}

const buckets = computed<HourBucket[]>(() => {
  const start = props.startHour ?? 0
  const end = props.endHour ?? 24
  const days = dayCount.value

  const hourMap = new Map<number, { count: number, gaps: number[] }>()
  for (let h = start; h < end; h++) {
    hourMap.set(h, { count: 0, gaps: [] })
  }

  for (const dep of filteredDepartures.value) {
    const hour = Math.floor(dep.departureTime / 3600)
    const entry = hourMap.get(hour)
    if (entry) {
      entry.count++
      if (dep.gapToNext != null && !dep.gapIsNoise) {
        entry.gaps.push(dep.gapToNext)
      }
    }
  }

  const maxAvg = Math.max(1, ...Array.from(hourMap.values()).map(v => v.count / days))

  const result: HourBucket[] = []
  for (let h = start; h < end; h++) {
    const entry = hourMap.get(h)!
    const avg = entry.count / days
    const avgGap = entry.gaps.length > 0
      ? entry.gaps.reduce((a, b) => a + b, 0) / entry.gaps.length
      : null
    result.push({
      hour: h,
      label: `${h % 24}`,
      total: entry.count,
      avg: Math.round(avg * 10) / 10,
      avgHeadway: avgGap != null ? Math.round(avgGap) : null,
      barHeight: (avg / maxAvg) * 100,
    })
  }
  return result
})

const hasAnyHeadway = computed(() => buckets.value.some(b => b.avgHeadway != null))

const totals = computed(() => {
  const deps = filteredDepartures.value
  const total = deps.length
  const avgPerDay = Math.round((total / dayCount.value) * 10) / 10
  const gaps = deps
    .filter(d => d.gapToNext != null && !d.gapIsNoise)
    .map(d => d.gapToNext!)
  const avgHeadway = gaps.length > 0
    ? gaps.reduce((a, b) => a + b, 0) / gaps.length
    : null
  gaps.sort((a, b) => a - b)
  const medianHeadway = gaps.length > 0
    ? gaps.length % 2 === 1
      ? gaps[Math.floor(gaps.length / 2)]!
      : (gaps[gaps.length / 2 - 1]! + gaps[gaps.length / 2]!) / 2
    : null
  const gapCount = gaps.length
  const gapsPerDay = Math.round((gapCount / dayCount.value) * 10) / 10
  return { total, avgPerDay, gapCount, gapsPerDay, medianHeadway, avgHeadway }
})

const statsTooltip = computed(() => {
  const lines = ['Total departures in this hour']
  if (dayCount.value > 1) {
    lines.push(`Average departures per day (${dayCount.value} days)`)
  }
  if (hasAnyHeadway.value) {
    lines.push('~Average headway')
  }
  return lines.join(' · ')
})
</script>

<style scoped lang="scss">
.hourly-departures-chart {
  margin: 0.75rem 0;
}

.hourly-departures-date-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 20px;
}

.hourly-departures-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
}

.hourly-departures-bar-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
}

.hourly-departures-bar-stats {
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 10px;
  line-height: 1.3;
  min-height: 40px;
  justify-content: flex-end;
  margin-bottom: 2px;

  span:first-child {
    font-weight: 600;
  }

  span:nth-child(2) {
    color: #666;
  }

  span:nth-child(3) {
    color: #888;
  }
}

.hourly-departures-bar-container {
  width: 100%;
  height: 120px;
  display: flex;
  align-items: flex-end;
}

.hourly-departures-bar {
  width: 100%;
  background: #3273dc;
  border-radius: 2px 2px 0 0;
  min-height: 0;
  transition: height 0.2s ease;
}

.hourly-departures-hour-label {
  font-size: 11px;
  margin-top: 4px;
  color: #555;
}

.hourly-departures-legend {
  font-size: 12px;
  color: #888;
  margin-top: 8px;
  display: flex;
  gap: 8px;
}

.hourly-departures-totals {
  margin-top: 12px;
  font-size: 13px;

  div {
    display: flex;
    gap: 8px;
  }

  dt {
    font-weight: 600;
  }
}
</style>
