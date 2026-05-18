<template>
  <div class="cal-fv-row" :class="{ 'is-active': isActive }">
    <cat-tooltip :text="tooltip">
      <span class="cal-fv-row-fetched">
        {{ fetchedAtShort }}
        <span v-if="isActive" class="cal-fv-active-dot" />
      </span>
    </cat-tooltip>
    <cal-feed-version-timeline
      class="cal-fv-row-timeline"
      :service-levels="fv.service_levels"
      :domain-start="domainStart"
      :domain-end="domainEnd"
      :analysis-start="analysisStart"
      :analysis-end="analysisEnd"
      :max-day-seconds="maxDaySeconds"
      :earliest-calendar-date="fv.earliest_calendar_date"
      :latest-calendar-date="fv.latest_calendar_date"
      :feed-info-start-date="fv.service_window?.feed_start_date"
      :feed-info-end-date="fv.service_window?.feed_end_date"
    />
    <div class="cal-fv-row-action">
      <cat-button
        size="small"
        :disabled="status === 'imported' || status === 'in_progress'"
        @click="emit('import', fv.id)"
      >
        {{ importLabel }}
      </cat-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { parseISO, format } from 'date-fns'
import CalFeedVersionTimeline from '~/components/cal/feed-version-timeline.vue'
import { feedVersionImportStatus, type FeedVersionDetail, type FeedVersionImportStatus } from '~~/src/tl'

const props = defineProps<{
  fv: FeedVersionDetail
  isActive: boolean
  hasActiveJob: boolean
  domainStart: Date
  domainEnd: Date
  analysisStart?: Date | null
  analysisEnd?: Date | null
  maxDaySeconds?: number
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
}>()

const status = computed<FeedVersionImportStatus>(() => feedVersionImportStatus(props.fv.feed_version_gtfs_import, props.hasActiveJob))

const fetchedAtShort = computed(() => {
  const d = parseISO(props.fv.fetched_at)
  return Number.isNaN(d.getTime()) ? props.fv.fetched_at : format(d, 'yyyy-MM-dd')
})

const statusLabel = computed(() => {
  switch (status.value) {
    case 'imported': return 'Imported'
    case 'in_progress': return 'In progress'
    case 'error': return 'Import error'
    default: return 'Not imported'
  }
})

const tooltip = computed(() => {
  const lines = [
    `Fetched: ${fetchedAtShort.value}`,
    `SHA1: ${props.fv.sha1}`,
    `Range: ${props.fv.earliest_calendar_date} – ${props.fv.latest_calendar_date}`,
    `Status: ${statusLabel.value}`,
  ]
  if (props.isActive) { lines.push('Active feed version') }
  const errLog = props.fv.feed_version_gtfs_import?.exception_log
  if (status.value === 'error' && errLog) {
    lines.push('', `Error: ${errLog.slice(0, 500)}${errLog.length > 500 ? '…' : ''}`)
  }
  return lines.join('\n')
})

const importLabel = computed(() => {
  switch (status.value) {
    case 'imported': return 'Imported'
    case 'in_progress': return 'In progress…'
    case 'error': return 'Retry'
    default: return 'Import'
  }
})
</script>

<style scoped>
.cal-fv-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.cal-fv-row-fetched {
  flex: 0 0 auto;
  min-width: 110px;
  font-family: monospace;
  font-size: 0.85rem;
  color: #333;
  cursor: help;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cal-fv-row-timeline {
  flex: 1 1 auto;
  min-width: 0;
}
.cal-fv-row-action {
  flex: 0 0 auto;
  width: 110px;
  display: flex;
  justify-content: flex-end;
}
.cal-fv-row-action :deep(.cat-button) {
  width: 100%;
}
.cal-fv-active-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1d6fb8;
}
</style>
