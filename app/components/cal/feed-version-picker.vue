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
      :active-job-fv-ids="emptyActiveJobs"
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
import { addDays, subDays } from 'date-fns'
import CalFeedVersionList from '~/components/cal/feed-version-list.vue'
import CalFeedVersionTimelineLegend from '~/components/cal/feed-version-timeline-legend.vue'
import {
  feedsForImportQuery,
  feedVersionHasServiceInRange,
  feedVersionServiceSecondsInRange,
  parseFvids,
  serializeFvids,
  HIDDEN_FEED_ONESTOP_IDS,
  type FeedWithVersions,
} from '~~/src/tl'
import { convertBbox, type Bbox } from '~~/src/core'
import { useToastNotification } from '#imports'

// Timeline domain pads the analysis window so users can see FVs that almost
// cover. Falls back to ±90d around today when the analysis window is unset.
const DOMAIN_BUFFER_DAYS = 7

const props = withDefaults(defineProps<{
  bbox: Bbox
  analysisStart?: Date | null
  analysisEnd?: Date | null
  // When true the picker renders per-row radios and per-feed exclude
  // checkboxes; emits change via `update:modelValue` as a CSV `fvids` string.
  selectable?: boolean
  // CSV `fvids` value (e.g. "osid1:123,osid2:0"). Empty string = no overrides.
  modelValue?: string
  // Whether to bypass the in-domain service filter and show every FV.
  showAllFeeds?: boolean
}>(), {
  analysisStart: null,
  analysisEnd: null,
  selectable: false,
  modelValue: '',
  showAllFeeds: false,
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:showAllFeeds', value: boolean): void
  // Stream the de-duped list of feeds the bbox query returned so parents
  // (e.g. the modal) can drive bulk actions like "Exclude all".
  (e: 'update:feedOnestopIds', value: string[]): void
}>()

const bboxValid = computed(() => !!props.bbox?.valid)

const domainStart = computed(() => {
  const s = props.analysisStart ?? subDays(new Date(), 90)
  return subDays(s, DOMAIN_BUFFER_DAYS)
})
const domainEnd = computed(() => {
  const e = props.analysisEnd ?? addDays(new Date(), 90)
  return addDays(e, DOMAIN_BUFFER_DAYS)
})

// Parsed view of the modelValue CSV. `explicitPicks` carries `osid → fv_id`
// for active overrides; `excludedFeeds` carries `osid` for excluded feeds.
const parsed = computed(() => parseFvids(props.modelValue))
const explicitPicks = computed<Map<string, number>>(() => parsed.value.picks)
const excludedFeeds = computed<Set<string>>(() => parsed.value.excluded)

function emitParsed (picks: Map<string, number>, excluded: Set<string>) {
  emit('update:modelValue', serializeFvids({ picks, excluded }))
}

function onSelect (feed: FeedWithVersions, fvId: number) {
  // Clone current state and apply the new pick. Drop the entry entirely when
  // the user selects the active FV — the default already covers that case
  // and keeps the URL clean.
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
  return { bbox: convertBbox(props.bbox) }
})

const { result, loading, error } = useQuery<{ feeds: FeedWithVersions[] }>(
  feedsForImportQuery,
  () => queryVars.value ?? {},
  () => ({ enabled: queryVars.value !== null })
)

const feeds = computed<FeedWithVersions[]>(() => result.value?.feeds || [])

// Surface the bbox-feeds set (minus the always-hidden denylist) to the
// parent so it can drive bulk operations without re-fetching.
watch(feeds, (fs) => {
  const ids: string[] = []
  for (const f of fs) {
    if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
    ids.push(f.onestop_id)
  }
  emit('update:feedOnestopIds', ids)
}, { immediate: true })

// Drop FVs with no scheduled service in the visible domain unless
// `showAllFeeds` is on. Always keep each feed's active FV. Sort feeds desc
// by the busiest FV's service total inside the analysis window (fallback to
// visible domain when dates are unset). Feeds with no surviving FVs are
// dropped from the picker entirely.
const visibleFeeds = computed<FeedWithVersions[]>(() => {
  const startIso = domainIso(domainStart.value)
  const endIso = domainIso(domainEnd.value)
  const sortStart = props.analysisStart ? domainIso(props.analysisStart) : startIso
  const sortEnd = props.analysisEnd ? domainIso(props.analysisEnd) : endIso

  const decorated: { feed: FeedWithVersions, sortKey: number }[] = []
  for (const f of feeds.value) {
    if (HIDDEN_FEED_ONESTOP_IDS.has(f.onestop_id)) { continue }
    const activeId = f.feed_state?.feed_version?.id ?? null
    const kept = props.showAllFeeds
      ? [...f.feed_versions]
      : f.feed_versions.filter(fv =>
          fv.id === activeId || feedVersionHasServiceInRange(fv.service_levels, startIso, endIso)
        )
    if (kept.length === 0) { continue }
    let sortKey = 0
    for (const fv of kept) {
      const s = feedVersionServiceSecondsInRange(fv.service_levels, sortStart, sortEnd)
      if (s > sortKey) { sortKey = s }
    }
    decorated.push({ feed: { ...f, feed_versions: kept }, sortKey })
  }
  decorated.sort((a, b) => b.sortKey - a.sortKey)
  return decorated.map(d => d.feed)
})

function domainIso (d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Active-jobs reconciliation is not wired yet (see PR #363 review). Stable
// empty Set so the prop reference doesn't churn between renders.
const emptyActiveJobs = new Set<number>()

function onImport (fvId: number) {
  // Submit + watch wiring lands with the modal/scenario integration.
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
