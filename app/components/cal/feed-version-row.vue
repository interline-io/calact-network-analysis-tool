<template>
  <div class="cal-fv-row" :class="{ 'is-selected': selected }">
    <cat-radio
      v-if="selectable"
      :model-value="selected ? fv.id : undefined"
      :native-value="fv.id"
      :name="`fv-${radioGroup}`"
      :disabled="excluded || status !== 'imported'"
      class="cal-fv-row-select"
      @update:model-value="emit('select', fv.id)"
    >
      <cat-tooltip :text="tooltip">
        <span class="cal-fv-row-fetched">
          {{ fetchedAtShort }}
          <span v-if="isActive" class="cal-fv-active-dot" />
        </span>
      </cat-tooltip>
    </cat-radio>
    <cat-tooltip v-else :text="tooltip">
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
      :editable="rangeEditable"
      @update:analysis-range="emit('update:analysisRange', $event)"
    />
    <div class="cal-fv-row-action">
      <cal-feed-version-import-button
        :fv="fv"
        :is-active="isActive"
        :pending-job="pendingJob"
        @import="(fvId) => emit('import', fvId)"
        @unimport="(fvId) => emit('unimport', fvId)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CalFeedVersionTimeline from '~/components/cal/feed-version-timeline.vue'
import CalFeedVersionImportButton from '~/components/cal/feed-version-import-button.vue'
import {
  effectiveImportStatus,
  FEED_VERSION_IMPORT_STATUS_LABELS,
  type FeedVersionDetail,
  type FeedVersionPendingJob,
} from '~~/src/tl'
import { fmtDate } from '~~/src/core'

const props = defineProps<{
  fv: FeedVersionDetail
  isActive: boolean
  domainStart: Date
  domainEnd: Date
  analysisStart?: Date | null
  analysisEnd?: Date | null
  maxDaySeconds?: number
  selectable?: boolean
  selected?: boolean
  // excluded disables the radio — the whole feed is excluded from the scenario.
  excluded?: boolean
  radioGroup?: string
  // Set when a feed-version-import job has been submitted in this session.
  // Overrides the GraphQL-derived status so the UI tracks the live job state
  // without a refetch.
  pendingJob?: FeedVersionPendingJob | null
  // Modal context: enables the timeline window drag.
  rangeEditable?: boolean
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
  (e: 'unimport', fvId: number): void
  (e: 'select', fvId: number): void
  (e: 'update:analysisRange', value: { start: string, end: string }): void
}>()

const fetchedAtShort = computed(() => fmtDate(props.fv.fetched_at) || props.fv.fetched_at)

const status = computed(() => effectiveImportStatus(props.fv, props.pendingJob))

const tooltip = computed(() => {
  const lines = [
    `Fetched: ${fetchedAtShort.value}`,
    `SHA1: ${props.fv.sha1}`,
    `Range: ${props.fv.earliest_calendar_date} – ${props.fv.latest_calendar_date}`,
    `Status: ${FEED_VERSION_IMPORT_STATUS_LABELS[status.value]}`,
  ]
  if (props.isActive) { lines.push('Active feed version') }
  const errLog = props.fv.feed_version_gtfs_import?.exception_log
  if (status.value === 'error' && errLog) {
    lines.push('', `Error: ${errLog.slice(0, 500)}${errLog.length > 500 ? '…' : ''}`)
  }
  return lines.join('\n')
})
</script>

<style scoped>
.cal-fv-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px;
}
.cal-fv-row.is-selected {
  background: rgba(29, 111, 184, 0.06);
  border-radius: 3px;
}
.cal-fv-row-select {
  flex: 0 0 auto;
}
.cal-fv-row-select .cal-fv-row-fetched {
  cursor: pointer;
}
.cal-fv-row-fetched {
  flex: 0 0 auto;
  min-width: 110px;
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
  /* Status tag + action button + job-status link, side by side. */
  width: 220px;
  display: flex;
  justify-content: flex-start;
}
.cal-fv-active-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1d6fb8;
}
</style>
