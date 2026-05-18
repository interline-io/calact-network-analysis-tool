<template>
  <cat-card class="cal-fv-feed-card">
    <template #header>
      <div class="cal-fv-feed-head">
        <div>
          <strong>{{ feed.name || feed.onestop_id }}</strong>
          <span v-if="showOnestopId" class="cal-fv-feed-osid">{{ feed.onestop_id }}</span>
        </div>
        <span class="cal-fv-feed-counts">
          {{ feed.feed_versions.length }} version{{ feed.feed_versions.length === 1 ? '' : 's' }}
        </span>
      </div>
    </template>
    <div v-if="sortedVersions.length === 0" class="cal-fv-feed-empty">
      No feed versions available.
    </div>
    <cal-feed-version-row
      v-for="fv in sortedVersions"
      :key="fv.id"
      :fv="fv"
      :is-active="activeFvId === fv.id"
      :has-active-job="activeJobFvIds.has(fv.id)"
      :domain-start="domainStart"
      :domain-end="domainEnd"
      :analysis-start="analysisStart"
      :analysis-end="analysisEnd"
      :max-day-seconds="maxDaySeconds"
      @import="emit('import', $event)"
    />
  </cat-card>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CalFeedVersionRow from '~/components/cal/feed-version-row.vue'
import type { FeedWithVersions } from '~~/src/tl'

const props = defineProps<{
  feed: FeedWithVersions
  activeJobFvIds: Set<number>
  domainStart: Date
  domainEnd: Date
  analysisStart?: Date | null
  analysisEnd?: Date | null
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
}>()

const activeFvId = computed(() => props.feed.feed_state?.feed_version?.id ?? null)

// Hide the redundant onestop_id chip when it's identical to the display name
// (or when the name is empty and we're already showing the onestop_id as
// the name).
const showOnestopId = computed(() => !!props.feed.name && props.feed.name !== props.feed.onestop_id)

// Feed-scoped opacity ceiling: largest single-day service across all of this
// feed's FVs. Each FV's timeline cells normalize against it so a quieter FV
// reads as quieter against its busier siblings.
const maxDaySeconds = computed<number>(() => {
  let max = 0
  for (const fv of props.feed.feed_versions) {
    for (const r of fv.service_levels) {
      for (const v of [r.monday, r.tuesday, r.wednesday, r.thursday, r.friday, r.saturday, r.sunday]) {
        if (v > max) { max = v }
      }
    }
  }
  return max
})

// Sort strictly by fetched_at desc; the active FV is tagged inline by the
// row and doesn't need to be promoted above newer versions.
const sortedVersions = computed(() => {
  return [...props.feed.feed_versions].sort(
    (a, b) => (b.fetched_at || '').localeCompare(a.fetched_at || '')
  )
})
</script>

<style scoped>
.cal-fv-feed-card {
  margin-bottom: 12px;
}
.cal-fv-feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cal-fv-feed-osid {
  color: #888;
  font-size: 0.85rem;
  margin-left: 8px;
  font-family: monospace;
}
.cal-fv-feed-counts {
  color: #666;
  font-size: 0.85rem;
}
.cal-fv-feed-empty {
  color: #888;
  font-style: italic;
  font-size: 0.9rem;
}
</style>
