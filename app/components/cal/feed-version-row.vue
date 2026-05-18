<template>
  <div class="cal-fv-row" :class="{ 'is-selected': selected }">
    <cat-radio
      v-if="selectable"
      :model-value="selected ? fv.id : undefined"
      :native-value="fv.id"
      :name="`fv-${radioGroup}`"
      :disabled="excluded"
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
    />
    <div class="cal-fv-row-action">
      <!-- Always rendered (even when disabled) so row heights stay uniform. -->
      <cat-button disabled>
        {{ importLabel }}
      </cat-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CalFeedVersionTimeline from '~/components/cal/feed-version-timeline.vue'
import { feedVersionImportStatus, type FeedVersionDetail, type FeedVersionImportStatus } from '~~/src/tl'
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
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
  (e: 'select', fvId: number): void
}>()

// hasActiveJob hardcoded false until the jobs API is wired (follow-up PR).
const status = computed<FeedVersionImportStatus>(() => feedVersionImportStatus(props.fv.feed_version_gtfs_import, false))

const fetchedAtShort = computed(() => fmtDate(props.fv.fetched_at) || props.fv.fetched_at)

const STATUS_LABELS: Record<FeedVersionImportStatus, { status: string, action: string }> = {
  imported: { status: 'Imported', action: 'Imported' },
  in_progress: { status: 'In progress', action: 'In progress…' },
  error: { status: 'Import error', action: 'Retry' },
  not_imported: { status: 'Not imported', action: 'Import' },
}

const statusLabel = computed(() => STATUS_LABELS[status.value].status)
const importLabel = computed(() => STATUS_LABELS[status.value].action)

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
  width: 110px;
  display: flex;
  justify-content: flex-start;
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
