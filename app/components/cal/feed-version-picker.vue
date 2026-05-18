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
      @import="onImport"
      @select="(fvId) => onSelect(feed, fvId)"
      @exclude="(v) => onExclude(feed, v)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
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
  type FeedWithVersions,
} from '~~/src/tl'
import { convertBbox, type Bbox } from '~~/src/core'
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
    serviceLevelStart: domainIso(domainEnd.value),
    serviceLevelEnd: domainIso(domainStart.value),
  }
})

const { result, loading, error } = useQuery<{ feeds: FeedWithVersions[] }>(
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

// Sort by busiest FV's in-window service. Active FV always kept so an empty
// analysis window doesn't drop a feed from the picker entirely.
const visibleFeeds = computed<FeedWithVersions[]>(() => {
  const startIso = domainIso(domainStart.value)
  const endIso = domainIso(domainEnd.value)
  const sortStart = domainIso(props.analysisStart)
  const sortEnd = domainIso(props.analysisEnd)

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

function domainIso (d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// TODO: wire jobs API in follow-up PR; stub keeps the row's emit interface stable.
function onImport (fvId: number) {
  useToastNotification().showToast(`Import for feed version ${fvId} — submit not wired yet`)
}
</script>

<style scoped>
.cal-fv-picker-loading,
.cal-fv-picker-empty {
  padding: 12px;
  color: #555;
}
</style>
