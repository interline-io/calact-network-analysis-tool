<template>
  <div class="cal-fv-import-button">
    <cat-tooltip v-if="errorTooltip" :text="errorTooltip">
      <cat-button
        class="cal-fv-import-button-cta"
        variant="danger"
        :disabled="!canAct"
        @click="onClick"
      >
        {{ buttonLabel }}
      </cat-button>
    </cat-tooltip>
    <cat-button
      v-else
      class="cal-fv-import-button-cta"
      :disabled="!canAct"
      :icon-left="isWatching ? 'clock' : undefined"
      @click="onClick"
    >
      {{ buttonLabel }}
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

const ACTION_LABELS: Record<FeedVersionImportStatus, string> = {
  imported: 'Imported',
  in_progress: 'In progress…',
  error: 'Retry',
  not_imported: 'Import',
}

const status = computed(() => effectiveImportStatus(props.fv, props.pendingJob))
const canImport = computed(() => status.value === 'not_imported' || status.value === 'error')
// Active FVs are protected — unimporting one would orphan the feed's pointer.
const canUnimport = computed(() => status.value === 'imported' && !props.isActive)
const canAct = computed(() => canImport.value || canUnimport.value)

const isWatching = computed(() => {
  const p = props.pendingJob
  return !!p && !JOB_TERMINAL_STATES.has(p.state)
})
const watchLabel = computed(() => capitalize(props.pendingJob?.state || ''))

const buttonLabel = computed(() => isWatching.value ? watchLabel.value : ACTION_LABELS[status.value])

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

function onClick () {
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
.cal-fv-import-button-cta {
  flex: 1 1 auto;
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
