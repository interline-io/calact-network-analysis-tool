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
      :range-editable="rangeEditable"
      @import="onImport"
      @unimport="onUnimport"
      @select="(fvId) => onSelect(feed, fvId)"
      @exclude="(v) => onExclude(feed, v)"
      @update:analysis-range="emit('update:analysisRange', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { refDebounced } from '@vueuse/core'
import { useQuery } from '@vue/apollo-composable'
import { addDays, differenceInDays, subDays } from 'date-fns'
import CalFeedVersionList from '~/components/cal/feed-version-list.vue'
import CalFeedVersionTimelineLegend from '~/components/cal/feed-version-timeline-legend.vue'
import {
  feedsForImportQuery,
  feedVersionHasServiceInRange,
  feedVersionServiceSecondsInRange,
  isoToOrdinal,
  ordinalToIso,
  parseFvids,
  pinnedFeedVersionsQuery,
  serializeFvids,
  type FeedVersionDetailWithFeed,
  DEPRIORITIZED_FEED_ONESTOP_IDS,
  watchJob,
  jobApiPath,
  JOBS_USE_SSE,
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
  // Modal context: rows render a draggable analysis window.
  rangeEditable?: boolean
}>(), {
  selectable: false,
  modelValue: '',
  rangeEditable: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  // Lets the parent drive bulk actions ("Exclude all") without re-fetching.
  (e: 'update:feedOnestopIds', value: string[]): void
  // Bubbled from the timelines' window drag; the modal
  // owns the staged dates, the picker just relays.
  (e: 'update:analysisRange', value: { start: string, end: string }): void
}>()

const bboxValid = computed(() => !!props.bbox?.valid)

// The analysis window (overlay) tracks props live so dragging feels glued to
// the pointer, but everything derived from it that would reshuffle the page —
// the timeline scale (domain), the feed sort order, the GraphQL query — runs
// off a debounced copy so rows don't rescale or resort mid-drag.
const analysisStartDebounced = refDebounced(computed(() => props.analysisStart), 300)
const analysisEndDebounced = refDebounced(computed(() => props.analysisEnd), 300)

const bufferDays = computed(() => Math.max(
  MIN_BUFFER_DAYS,
  differenceInDays(analysisEndDebounced.value, analysisStartDebounced.value)
))
const domainStart = computed(() => subDays(analysisStartDebounced.value, bufferDays.value))
const domainEnd = computed(() => addDays(analysisEndDebounced.value, bufferDays.value))

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

// The GraphQL fetch window snaps the visible domain out to a coarse grid: small
// date edits within the same cell keep identical query vars (so Apollo doesn't
// refetch), while the window stays proportional to the current domain — a
// far-and-back excursion can't permanently bloat it the way a grow-only window
// would.
const FETCH_GRID_DAYS = 90
function snapOrdinal (iso: string, dir: -1 | 1): string {
  const cell = Math.floor(isoToOrdinal(iso) / FETCH_GRID_DAYS)
  return ordinalToIso((dir < 0 ? cell : cell + 1) * FETCH_GRID_DAYS)
}
const fetchStartIso = computed(() => snapOrdinal(fmtDate(domainStart.value), -1))
const fetchEndIso = computed(() => snapOrdinal(fmtDate(domainEnd.value), 1))

const queryVars = computed(() => {
  if (!bboxValid.value) { return null }
  // serviceLevel{Start,End} and covers{Start,End} are both intentionally
  // swapped (windowEnd → start, windowStart → end) for overlap — see
  // feedsForImportQuery. service_levels use the padded fetch window (for
  // timeline context); covers uses the actual analysis window so the FV list
  // reflects the dates being queried.
  return {
    bbox: convertBbox(props.bbox),
    serviceLevelStart: fetchEndIso.value,
    serviceLevelEnd: fetchStartIso.value,
    coversStart: fmtDate(analysisEndDebounced.value),
    coversEnd: fmtDate(analysisStartDebounced.value),
  }
})

const { result, loading, error, refetch } = useQuery<{ feeds: FeedWithVersions[] }>(
  feedsForImportQuery,
  () => queryVars.value ?? {},
  () => ({ enabled: queryVars.value !== null })
)

const feeds = computed<FeedWithVersions[]>(() => result.value?.feeds || [])

watch(feeds, (fs) => {
  emit('update:feedOnestopIds', fs.map(f => f.onestop_id))
}, { immediate: true })

// Explicitly-pinned versions are fetched by id so the user's current selection
// always stays visible — even when it falls outside the browsed window, where
// the browse query's `covers` filter would otherwise drop it. Keyed by feed
// onestop_id for merging back into the matching row (one pick per feed).
const pinnedIds = computed(() => [...explicitPicks.value.values()])
const { result: pinnedResult } = useQuery<{ feed_versions: FeedVersionDetailWithFeed[] }>(
  pinnedFeedVersionsQuery,
  () => ({
    ids: pinnedIds.value,
    serviceLevelStart: fetchEndIso.value,
    serviceLevelEnd: fetchStartIso.value,
  }),
  () => ({ enabled: pinnedIds.value.length > 0 })
)
const pinnedByOnestop = computed<Map<string, FeedVersionDetailWithFeed>>(() => {
  const out = new Map<string, FeedVersionDetailWithFeed>()
  for (const fv of pinnedResult.value?.feed_versions || []) {
    out.set(fv.feed.onestop_id, fv)
  }
  return out
})

// Sort by busiest FV's in-window service. Active FV is always kept even when
// it has no in-window service, so operators can see what's currently running.
const visibleFeeds = computed<FeedWithVersions[]>(() => {
  const startIso = fmtDate(domainStart.value)
  const endIso = fmtDate(domainEnd.value)
  // Debounced so the list doesn't resort under an in-flight window drag.
  const sortStart = fmtDate(analysisStartDebounced.value)
  const sortEnd = fmtDate(analysisEndDebounced.value)

  const decorated: { feed: FeedWithVersions, sortKey: number, demoted: boolean }[] = []
  for (const f of feeds.value) {
    const activeId = f.feed_state?.feed_version?.id ?? null
    const kept = f.feed_versions.filter(fv =>
      fv.id === activeId || feedVersionHasServiceInRange(fv.service_levels, startIso, endIso)
    )
    // Always surface the user's pinned selection (at the top), even when it
    // falls outside the browsed window and the browse query's covers filter
    // dropped it from this feed's versions.
    const pinnedId = explicitPicks.value.get(f.onestop_id)
    if (pinnedId != null && !kept.some(fv => fv.id === pinnedId)) {
      const pinned = pinnedByOnestop.value.get(f.onestop_id)
      if (pinned && pinned.id === pinnedId) {
        kept.unshift(pinned)
      }
    }
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

// One handle per fvId — replaced on resubmit, drained on unmount.
const watchHandles = new Map<number, WatchJobHandle>()

// Session-wide job tracker (localStorage-backed) behind the sidebar badge
// and the /job-status index page.
const jobTracker = useJobTracker()

function queueForKind (kind: FeedVersionPendingJobKind): string {
  return kind === 'unimport' ? 'feed-version-unimport' : 'feed-version-import'
}

// Toast text helper — looks up the feed name and fetched_at so toasts read
// "TriMet (2024-01-15)" instead of "feed version 654523". Falls back to the
// fvId when the lookup misses (feed got hidden / data changed).
function describeFv (fvId: number): string {
  for (const f of feeds.value) {
    const fv = f.feed_versions.find(v => v.id === fvId)
    if (fv) {
      const name = f.name || f.onestop_id
      const fetched = fmtDate(fv.fetched_at) || fv.fetched_at
      return `${name} (${fetched})`
    }
  }
  return `feed version ${fvId}`
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
  // Optimistic placeholder so the button disables the moment the user clicks
  // — without it, a fast double-click before the POST resolves would submit
  // twice. Replaced with the real jobId on success, rolled back on failure.
  pendingJobs.value = {
    ...pendingJobs.value,
    [fvId]: { jobId: '', state: 'queued', kind },
  }
  const fvLabel = describeFv(fvId)
  try {
    const res = await fetch(jobApiPath(queue), {
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
    // Register with the session job tracker so the sidebar badge and the
    // /job-status index see this job (including from a new tab). The tracker
    // runs its own watcher; the per-row watcher below stays for modal UI.
    jobTracker.registerJob({ queue, jobId: idStr })
    unsubscribeJob(fvId)
    watchHandles.set(fvId, watchJob({
      queue,
      jobId: idStr,
      useSSE: JOBS_USE_SSE,
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
          toast.showToast(`${action} succeeded for ${fvLabel}`, 'success')
        } else if (state === 'failed') {
          toast.showToast(`${action} failed for ${fvLabel}${info?.message ? `: ${info.message}` : ''}`, 'danger', 5000)
        } else if (state === 'cancelled') {
          toast.showToast(`${action} cancelled for ${fvLabel}`, 'warning', 5000)
        }
      },
    }))
    toast.showToast(`${capitalize(kind)} submitted for ${fvLabel}`, 'success')
  } catch (e) {
    // Roll back the optimistic placeholder so the button is re-enabled and
    // the row reverts to its underlying graphql-derived status.
    const { [fvId]: _removed, ...rest } = pendingJobs.value
    void _removed
    pendingJobs.value = rest
    toast.showToast(`${capitalize(kind)} for ${fvLabel} failed: ${e instanceof Error ? e.message : String(e)}`, 'danger', 5000)
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
