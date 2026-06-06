<template>
  <div class="cal-fv-import-button">
    <!-- Status is read-only — a plain dot + label (same visual language as
         the row's "active" dot) so it can't be mistaken for a control. The
         action is a regular bordered button. -->
    <cat-tooltip v-if="errorTooltip" :text="errorTooltip">
      <span class="cal-fv-import-status">
        <span class="cal-fv-import-status-dot" :style="{ background: statusColor }" />
        {{ statusLabel }}
      </span>
    </cat-tooltip>
    <span v-else class="cal-fv-import-status">
      <cat-icon v-if="isWatching" icon="clock" size="small" />
      <span v-else class="cal-fv-import-status-dot" :style="{ background: statusColor }" />
      {{ statusLabel }}
    </span>

    <cat-button
      v-if="actionLabel"
      size="small"
      class="cal-fv-import-action"
      @click="onAction"
    >
      {{ actionLabel }}
    </cat-button>

    <a
      v-if="statusUrl"
      :href="statusUrl"
      target="_blank"
      rel="noopener"
      class="cal-fv-import-button-link"
      title="Open job status in new tab"
    >
      <cat-icon icon="open-in-new" />
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  effectiveImportStatus,
  FEED_VERSION_IMPORT_STATUS_LABELS,
  JOB_TERMINAL_STATES,
  type FeedVersionDetail,
  type FeedVersionImportStatus,
  type FeedVersionPendingJob,
} from '~~/src/tl'
import { capitalize } from '~~/src/core'

const props = defineProps<{
  fv: FeedVersionDetail
  isActive?: boolean
  pendingJob?: FeedVersionPendingJob | null
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
  (e: 'unimport', fvId: number): void
}>()

// Bulma-ish palette: success green, info blue, danger red, neutral grey.
const STATUS_COLORS: Record<FeedVersionImportStatus, string> = {
  imported: '#48c78e',
  in_progress: '#1d6fb8',
  error: '#f14668',
  not_imported: '#b5b5b5',
}

const status = computed(() => effectiveImportStatus(props.fv, props.pendingJob))
const canImport = computed(() => status.value === 'not_imported' || status.value === 'error')
// Active FVs are protected — unimporting one would orphan the feed's pointer.
const canUnimport = computed(() => status.value === 'imported' && !props.isActive)

const isWatching = computed(() => {
  const p = props.pendingJob
  return !!p && !JOB_TERMINAL_STATES.has(p.state)
})

// While a job submitted this session is live, the tag tracks the job state
// (Queued / Running) instead of the generic "In progress…".
const statusLabel = computed(() => {
  if (isWatching.value) { return capitalize(props.pendingJob?.state || '') }
  return FEED_VERSION_IMPORT_STATUS_LABELS[status.value]
})
const statusColor = computed(() => STATUS_COLORS[status.value])

const actionLabel = computed(() => {
  if (isWatching.value) { return '' }
  if (status.value === 'error') { return 'Retry' }
  if (canImport.value) { return 'Import' }
  if (canUnimport.value) { return 'Unimport' }
  return ''
})

const statusUrl = computed(() => {
  // Empty jobId is the optimistic-submit placeholder window; suppress the
  // link until the real id arrives so we don't render a broken URL.
  const p = props.pendingJob
  if (!p || !p.jobId) { return '' }
  const queue = p.kind === 'unimport' ? 'feed-version-unimport' : 'feed-version-import'
  return `/job-status/${queue}/${encodeURIComponent(p.jobId)}`
})

// Only surface a tooltip when there's actually error text to show — empty
// or trimmed-whitespace messages would render an empty hover bubble. Cap
// the length so a multi-line stack trace doesn't overflow the tooltip; the
// full text is still available on the job-status page.
const MAX_ERROR_TOOLTIP_LEN = 200
const errorTooltip = computed(() => {
  if (status.value !== 'error') { return '' }
  const msg = props.pendingJob?.errorMessage?.trim()
  if (!msg) { return '' }
  return msg.length > MAX_ERROR_TOOLTIP_LEN
    ? msg.slice(0, MAX_ERROR_TOOLTIP_LEN) + '…'
    : msg
})

function onAction () {
  if (canImport.value) {
    emit('import', props.fv.id)
  } else if (canUnimport.value) {
    emit('unimport', props.fv.id)
  }
}
</script>

<style scoped>
.cal-fv-import-button {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}
.cal-fv-import-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #555;
  font-size: 0.85rem;
  white-space: nowrap;
}
.cal-fv-import-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.cal-fv-import-action {
  flex: 0 0 auto;
}
.cal-fv-import-button-link {
  flex: 0 0 auto;
  color: #555;
  display: inline-flex;
  align-items: center;
}
.cal-fv-import-button-link:hover {
  color: #1d6fb8;
}
</style>
