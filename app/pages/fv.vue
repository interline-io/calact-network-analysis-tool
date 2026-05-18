<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid cal-fv-page">
        <cal-title title="Feed Version Browser" />

        <cat-msg variant="info">
          Browse feeds in a bounding box and their available feed versions. Use this to import a version that
          covers your analysis dates but isn't currently available via the API.
        </cat-msg>

        <div class="cal-fv-controls">
          <cat-field label="Bbox">
            <cat-input v-model="bboxString" placeholder="min_lon,min_lat,max_lon,max_lat" />
          </cat-field>
          <cat-field label="Analysis start">
            <cat-input v-model="startDateString" type="date" />
          </cat-field>
          <cat-field label="Analysis end">
            <cat-input v-model="endDateString" type="date" />
          </cat-field>
        </div>

        <div v-if="loading" class="cal-fv-loading">
          <cat-icon icon="loading" /> Loading feeds…
        </div>
        <cat-notification v-if="error" variant="danger">
          {{ error.message || String(error) }}
        </cat-notification>

        <div v-if="!loading && feeds.length === 0 && bboxValid" class="cal-fv-empty">
          No GTFS feeds found in this bounding box.
        </div>

        <cal-feed-version-timeline-legend v-if="visibleFeeds.length > 0" />

        <cal-feed-version-list
          v-for="feed in visibleFeeds"
          :key="feed.id"
          :feed="feed"
          :active-job-fv-ids="activeJobFvIds"
          :domain-start="domainStart"
          :domain-end="domainEnd"
          :analysis-start="analysisStart"
          :analysis-end="analysisEnd"
          @import="onImport"
        />

        <div v-if="activeJobsError" class="cal-fv-jobs-error">
          <cat-icon icon="alert" /> Could not load active jobs: {{ activeJobsError }}
        </div>
      </div>
    </template>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { addDays, subDays, format } from 'date-fns'
import CalFeedVersionList from '~/components/cal/feed-version-list.vue'
import CalFeedVersionTimelineLegend from '~/components/cal/feed-version-timeline-legend.vue'
import {
  feedsForImportQuery,
  feedVersionHasServiceInRange,
  feedVersionServiceSecondsInRange,
  type FeedWithVersions,
} from '~~/src/tl'
import {
  parseDate,
  convertBbox,
  parseBbox,
  bboxString as bboxToString,
  type Bbox,
} from '~~/src/core'
import { useToastNotification } from '#imports'

definePageMeta({
  layout: false,
})

const route = useRoute()
const { setQuery } = useUrlQuery()

// Inputs (URL-backed for shareability + round-trip with /tne)
const DEFAULT_BBOX = '-122.8,45.4,-122.5,45.7' // Portland, OR

const bboxString = computed<string>({
  get: () => route.query.bbox?.toString() || DEFAULT_BBOX,
  set: (v) => { setQuery({ bbox: v || undefined }) }
})

const startDateString = computed<string>({
  get: () => route.query.startDate?.toString() || '',
  set: (v) => { setQuery({ startDate: v || undefined }) }
})

const endDateString = computed<string>({
  get: () => route.query.endDate?.toString() || '',
  set: (v) => { setQuery({ endDate: v || undefined }) }
})

const bbox = computed<Bbox>(() => parseBbox(bboxString.value))
const bboxValid = computed(() => bbox.value.valid)

const analysisStart = computed<Date | null>(() => parseDate(startDateString.value) || null)
const analysisEnd = computed<Date | null>(() => parseDate(endDateString.value) || null)

// Timeline domain: padded around the analysis window so users can see FVs
// that almost cover. Falls back to ±90d around today if dates are unset.
const DOMAIN_BUFFER_DAYS = 7

const domainStart = computed(() => {
  const s = analysisStart.value ?? subDays(new Date(), 90)
  return subDays(s, DOMAIN_BUFFER_DAYS)
})
const domainEnd = computed(() => {
  const e = analysisEnd.value ?? addDays(new Date(), 90)
  return addDays(e, DOMAIN_BUFFER_DAYS)
})

// GraphQL: feeds-in-bbox + their FVs + service_levels + import status.
const queryVars = computed(() => {
  if (!bboxValid.value) { return null }
  return {
    bbox: convertBbox(bbox.value),
  }
})

const { result, loading, error } = useQuery<{ feeds: FeedWithVersions[] }>(
  feedsForImportQuery,
  () => queryVars.value ?? {},
  () => ({ enabled: queryVars.value !== null })
)

const feeds = computed<FeedWithVersions[]>(() => result.value?.feeds || [])

// Drop FVs with no scheduled service in the visible domain, but always keep
// the feed's active version so users can still locate "what's served today"
// even if its imported window has lapsed. Feeds with no surviving FVs are
// dropped from the page entirely. Then sort feeds desc by the busiest FV's
// in-analysis-window service total — feeds with the heaviest single FV in
// the window appear first. Falls back to the visible domain when no
// analysis dates are picked.
const visibleFeeds = computed<FeedWithVersions[]>(() => {
  const startIso = domainIso(domainStart.value)
  const endIso = domainIso(domainEnd.value)
  const sortStart = analysisStart.value ? domainIso(analysisStart.value) : startIso
  const sortEnd = analysisEnd.value ? domainIso(analysisEnd.value) : endIso

  const decorated: { feed: FeedWithVersions, sortKey: number }[] = []
  for (const f of feeds.value) {
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

// DEBUG: dump service_levels for every FV so we can see what the API returns.
// Logs once per query response.
watch(feeds, (fs) => {
  if (!fs.length) { return }
  console.debug('[fv.vue] queryVars', queryVars.value)
  for (const f of fs) {
    for (const fv of f.feed_versions) {
      console.debug(
        `[fv.vue] feed=${f.onestop_id} fv_id=${fv.id} sha1=${fv.sha1.slice(0, 8)}`,
        `range=${fv.earliest_calendar_date}..${fv.latest_calendar_date}`,
        `service_levels.length=${fv.service_levels?.length ?? 0}`,
        fv.service_levels?.slice(0, 3),
      )
    }
  }
}, { immediate: true })

// Active jobs reconciliation is temporarily disabled: the configured proxy
// backend (production www.transit.land) redirects /jobs/... cross-origin and
// CORS blocks the response. Re-enable once the dev tlv2 is reachable or the
// proxy targets a backend that hosts /jobs.
const activeJobFvIds = ref<Set<number>>(new Set())
const activeJobsError = ref<string | null>(null)

function onImport (fvId: number) {
  // Submit + watch wiring lands in a follow-up; for now just flag it.
  useToastNotification().showToast(`Import for feed version ${fvId} — submit not wired yet`)
}

// Hint the user when the bbox or dates are missing.
watch([bboxString, startDateString, endDateString], () => {
  if (!bboxString.value) {
    // No-op — user sees the empty-state hint via cat-msg.
  }
}, { immediate: false })

// For dev convenience: dump the chosen domain to the console once on mount.
if (typeof window !== 'undefined') {
  console.debug('[fv.vue] bbox', bboxToString(bbox.value), 'domain', format(domainStart.value, 'yyyy-MM-dd'), '→', format(domainEnd.value, 'yyyy-MM-dd'))
}
</script>

<style scoped>
.cal-fv-page {
  padding: 16px 24px;
  max-width: 1200px;
}
.cal-fv-controls {
  display: flex;
  gap: 12px;
  margin: 16px 0;
  flex-wrap: wrap;
}
.cal-fv-loading,
.cal-fv-empty {
  padding: 12px;
  color: #555;
}
.cal-fv-jobs-error {
  margin-top: 12px;
  color: #b94a48;
  font-size: 0.9rem;
}
</style>
