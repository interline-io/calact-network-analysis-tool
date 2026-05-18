<template>
  <div class="cal-fv-picker">
    <div v-if="loading" class="cal-fv-picker-loading">
      <cat-icon icon="loading" /> Loading feeds…
    </div>
    <cat-notification v-if="error" variant="danger">
      {{ error.message || String(error) }}
    </cat-notification>

    <div v-if="!loading && feeds.length === 0 && bboxValid" class="cal-fv-picker-empty">
      No GTFS feeds found in this bounding box.
    </div>
    <div v-if="!loading && !bboxValid" class="cal-fv-picker-empty">
      Choose a bounding box to browse feeds.
    </div>

    <cal-feed-version-timeline-legend v-if="visibleFeeds.length > 0" />

    <cal-feed-version-list
      v-for="feed in visibleFeeds"
      :key="feed.id"
      :feed="feed"
      :domain-start="domainStart"
      :domain-end="domainEnd"
      :analysis-start="analysisStart"
      :analysis-end="analysisEnd"
      :selectable="selectable"
      :selected-fv-id="explicitPicks.get(feed.onestop_id) ?? null"
      :excluded="excludedFeeds.has(feed.onestop_id)"
      :pending-jobs="pendingJobs"
      @import="onImport"
      @unimport="onUnimport"
      @select="(fvId) => onSelect(feed, fvId)"
      @exclude="(v) => onExclude(feed, v)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { addDays, differenceInDays, subDays } from 'date-fns'
import CalFeedVersionList from '~/components/cal/feed-version-list.vue'
import CalFeedVersionTimelineLegend from '~/components/cal/feed-version-timeline-legend.vue'
import {
  feedsForImportQuery,
  feedVersionHasServiceInRange,
  feedVersionServiceSecondsInRange,
  parseFvids,
  serializeFvids,
  HIDDEN_FEED_ONESTOP_IDS,
  DEPRIORITIZED_FEED_ONESTOP_IDS,
  watchJob,
  JOB_TERMINAL_STATES,
  type FeedVersionPendingJob,
  type FeedVersionPendingJobKind,
  type FeedWithVersions,
  type WatchJobHandle,
} from '~~/src/tl'
import { capitalize, convertBbox, fmtDate, type Bbox } from '~~/src/core'
import { useToastNotification } from '#imports'

// Pad the analysis window so FVs that almost-cover still render. Scales with
// the window length so a multi-month query gets context on each side.
const MIN_BUFFER_DAYS = 7

const props = withDefaults(defineProps<{
  bbox: Bbox
  analysisStart: Date
  analysisEnd: Date
  selectable?: boolean
  modelValue?: string
}>(), {
  selectable: false,
  modelValue: '',
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  // Lets the parent drive bulk actions ("Exclude all") without re-fetching.
  (e: 'update:feedOnestopIds', value: string[]): void
}>()

const bboxValid = computed(() => !!props.bbox?.valid)

const bufferDays = computed(() => Math.max(
  MIN_BUFFER_DAYS,
  differenceInDays(props.analysisEnd, props.analysisStart)
))
const domainStart = computed(() => subDays(props.analysisStart, bufferDays.value))
const domainEnd = computed(() => addDays(props.analysisEnd, bufferDays.value))

const parsed = computed(() => parseFvids(props.modelValue))
const explicitPicks = computed<Map<string, number>>(() => parsed.value.picks)
const excludedFeeds = computed<Set<string>>(() => parsed.value.excluded)

function emitParsed (picks: Map<string, number>, excluded: Set<string>) {
  emit('update:modelValue', serializeFvids({ picks, excluded }))
}

function onSelect (feed: FeedWithVersions, fvId: number) {
  // Drop the entry when the pick equals the active FV — keeps the URL clean.
  const picks = new Map(explicitPicks.value)
  const excluded = new Set(excludedFeeds.value)
  excluded.delete(feed.onestop_id)
  const activeId = feed.feed_state?.feed_version?.id ?? null
  if (fvId === activeId) {
    picks.delete(feed.onestop_id)
  } else {
    picks.set(feed.onestop_id, fvId)
  }
  emitParsed(picks, excluded)
}

function onExclude (feed: FeedWithVersions, value: boolean) {
  const picks = new Map(explicitPicks.value)
  const excluded = new Set(excludedFeeds.value)
  if (value) {
    excluded.add(feed.onestop_id)
    picks.delete(feed.onestop_id)
  } else {
    excluded.delete(feed.onestop_id)
  }
  emitParsed(picks, excluded)
}

const queryVars = computed(() => {
  if (!bboxValid.value) { return null }
  // serviceLevel{Start,End} are intentionally swapped — see feedsForImportQuery.
  return {
    bbox: convertBbox(props.bbox),
    serviceLevelStart: fmtDate(domainEnd.value),
    serviceLevelEnd: fmtDate(domainStart.value),
  }
})

const { result, loading, error, refetch } = useQuery<{ feeds: FeedWithVersions[] }>(
  feedsForImportQuery,
  () => queryVars.value ?? {},
  () => ({ enabled: queryVars.value !== null })
)

const feeds = computed<FeedWithVersions[]>(() => result.value?.feeds || [])

watch(feeds, (fs) => {
  const ids: string[] = []
  for (const f of fs) {
    if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
    ids.push(f.onestop_id)
  }
  emit('update:feedOnestopIds', ids)
}, { immediate: true })

// Sort by busiest FV's in-window service. Active FV is always kept even when
// it has no in-window service, so operators can see what's currently running.
const visibleFeeds = computed<FeedWithVersions[]>(() => {
  const startIso = fmtDate(domainStart.value)
  const endIso = fmtDate(domainEnd.value)
  const sortStart = fmtDate(props.analysisStart)
  const sortEnd = fmtDate(props.analysisEnd)

  const decorated: { feed: FeedWithVersions, sortKey: number, demoted: boolean }[] = []
  for (const f of feeds.value) {
    if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
    const activeId = f.feed_state?.feed_version?.id ?? null
    const kept = f.feed_versions.filter(fv =>
      fv.id === activeId || feedVersionHasServiceInRange(fv.service_levels, startIso, endIso)
    )
    if (kept.length === 0) { continue }
    let sortKey = 0
    for (const fv of kept) {
      const s = feedVersionServiceSecondsInRange(fv.service_levels, sortStart, sortEnd)
      if (s > sortKey) { sortKey = s }
    }
    decorated.push({
      feed: { ...f, feed_versions: kept },
      sortKey,
      demoted: DEPRIORITIZED_FEED_ONESTOP_IDS.has(f.onestop_id),
    })
  }
  decorated.sort((a, b) => {
    if (a.demoted !== b.demoted) { return a.demoted ? 1 : -1 }
    return b.sortKey - a.sortKey
  })
  return decorated.map(d => d.feed)
})

// pendingJobs is keyed by feed-version id and propagates down to each row so
// the import button can switch into "watch" mode. Entries persist for the life
// of the picker — once a job hits a terminal state the row reflects the new
// status (imported/error) without needing a graphql refetch.
const pendingJobs = ref<Record<number, FeedVersionPendingJob>>({})

// true → /watch SSE; false → JobGet polling. Shared with the status page;
// toggle while debugging.
const sse = false

// One handle per fvId — replaced on resubmit, drained on unmount.
const watchHandles = new Map<number, WatchJobHandle>()

function queueForKind (kind: FeedVersionPendingJobKind): string {
  return kind === 'unimport' ? 'feed-version-unimport' : 'feed-version-import'
}

function unsubscribeJob (fvId: number) {
  const h = watchHandles.get(fvId)
  if (h != null) {
    h.unsubscribe()
    watchHandles.delete(fvId)
  }
}

async function submitJob (fvId: number, kind: FeedVersionPendingJobKind) {
  const toast = useToastNotification()
  const queue = queueForKind(kind)
  try {
    const res = await fetch(`/proxy/default/jobs/queues/${queue}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: queue, args: { feed_version_id: fvId } }),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} — ${text}`)
    }
    const parsed = JSON.parse(text)
    const jobId = parsed?.job?.id
    if (!jobId) {
      throw new Error('Job submitted but no id returned')
    }
    const idStr = String(jobId)
    pendingJobs.value = {
      ...pendingJobs.value,
      [fvId]: { jobId: idStr, state: parsed.state || 'queued', kind },
    }
    unsubscribeJob(fvId)
    watchHandles.set(fvId, watchJob({
      queue,
      jobId: idStr,
      useSSE: sse,
      pollIntervalMs: 1000,
      onState: (state, info) => {
        pendingJobs.value = {
          ...pendingJobs.value,
          [fvId]: { jobId: idStr, state, kind, errorMessage: info?.message },
        }
        if (!JOB_TERMINAL_STATES.has(state)) { return }
        // Refresh the underlying graphql data so feed_version_gtfs_import
        // catches up — the pendingJobs override is only in-memory and won't
        // survive a modal close/reopen otherwise.
        void refetch()
        const action = capitalize(kind)
        if (state === 'succeeded') {
          toast.showToast(`${action} succeeded for feed version ${fvId}`, 'success')
        } else if (state === 'failed') {
          toast.showToast(`${action} failed for feed version ${fvId}${info?.message ? `: ${info.message}` : ''}`, 'danger', 5000)
        } else if (state === 'cancelled') {
          toast.showToast(`${action} cancelled for feed version ${fvId}`, 'warning', 5000)
        }
      },
    }))
    toast.showToast(`${capitalize(kind)} submitted for feed version ${fvId}`, 'success')
  } catch (e) {
    toast.showToast(`${capitalize(kind)} failed: ${e instanceof Error ? e.message : String(e)}`, 'danger', 5000)
  }
}

function onImport (fvId: number) {
  submitJob(fvId, 'import')
}

function onUnimport (fvId: number) {
  if (!confirm('Unimport this feed version? This removes the imported GTFS data from the database; it will need to be re-imported if needed.')) {
    return
  }
  submitJob(fvId, 'unimport')
}

onBeforeUnmount(() => {
  for (const h of watchHandles.values()) { h.unsubscribe() }
  watchHandles.clear()
})
</script>

<style scoped>
.cal-fv-picker-loading,
.cal-fv-picker-empty {
  padding: 12px;
  color: #555;
}
</style>
