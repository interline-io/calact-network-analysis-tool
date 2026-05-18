<template>
  <cat-card class="cal-fv-feed-card" :class="{ 'is-excluded': excluded }">
    <template #header>
      <div class="card-header-title cal-fv-feed-title-block">
        <div class="cal-fv-feed-title-row">
          <div class="cal-fv-feed-title-name">
            <span>{{ feed.name || feed.onestop_id }}</span>
            <span v-if="showOnestopId" class="has-text-grey has-text-weight-normal cal-fv-feed-osid">
              {{ feed.onestop_id }}
            </span>
          </div>
          <div class="cal-fv-feed-title-actions">
            <span class="has-text-grey has-text-weight-normal">
              {{ feed.feed_versions.length }} version{{ feed.feed_versions.length === 1 ? '' : 's' }}
            </span>
            <cat-tooltip v-if="selectable" text="Exclude this feed from the scenario">
              <cat-checkbox
                :model-value="!!excluded"
                @update:model-value="(v) => emit('exclude', v)"
              >
                Exclude
              </cat-checkbox>
            </cat-tooltip>
          </div>
        </div>
        <!-- Clipped + faded by default since some feeds publish 30+ agencies. -->
        <div
          v-if="agencyNames.length > 0"
          class="cal-fv-feed-agencies has-text-grey has-text-weight-normal"
          :class="{ 'is-expanded': agenciesExpanded }"
          :title="agenciesExpanded ? 'Collapse' : 'Click to expand'"
          @click="agenciesExpanded = !agenciesExpanded"
        >
          {{ agencyNames.join(', ') }}
        </div>
      </div>
    </template>
    <p v-if="sortedVersions.length === 0" class="has-text-grey is-italic">
      No feed versions available.
    </p>
    <cal-feed-version-row
      v-for="fv in sortedVersions"
      :key="fv.id"
      :fv="fv"
      :is-active="activeFvId === fv.id"
      :domain-start="domainStart"
      :domain-end="domainEnd"
      :analysis-start="analysisStart"
      :analysis-end="analysisEnd"
      :max-day-seconds="maxDaySeconds"
      :selectable="selectable"
      :selected="effectiveSelectedFvId === fv.id"
      :excluded="excluded"
      :radio-group="feed.onestop_id"
      @import="emit('import', $event)"
      @select="emit('select', $event)"
    />
  </cat-card>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import CalFeedVersionRow from '~/components/cal/feed-version-row.vue'
import { maxServiceSecondsPerDay, type FeedWithVersions } from '~~/src/tl'

const props = defineProps<{
  feed: FeedWithVersions
  domainStart: Date
  domainEnd: Date
  analysisStart?: Date | null
  analysisEnd?: Date | null
  selectable?: boolean
  // null = use the feed's active FV.
  selectedFvId?: number | null
  excluded?: boolean
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
  (e: 'select', fvId: number): void
  (e: 'exclude', value: boolean): void
}>()

const activeFvId = computed(() => props.feed.feed_state?.feed_version?.id ?? null)

// Excluded feeds intentionally render with no checked row so the user can see
// the feed has no FV in play.
const effectiveSelectedFvId = computed(() => {
  if (props.excluded) { return null }
  return props.selectedFvId ?? activeFvId.value
})

const showOnestopId = computed(() => !!props.feed.name && props.feed.name !== props.feed.onestop_id)

const agenciesExpanded = ref(false)

const agencyNames = computed<string[]>(() => {
  const ags = props.feed.feed_state?.feed_version?.agencies ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of ags) {
    const name = a.agency_name
    if (!name || seen.has(name)) { continue }
    seen.add(name)
    out.push(name)
  }
  return out
})

// Feed-scoped ceiling so quieter FVs read as quieter against their busier siblings.
const maxDaySeconds = computed<number>(() => {
  let max = 0
  for (const fv of props.feed.feed_versions) {
    const m = maxServiceSecondsPerDay(fv.service_levels)
    if (m > max) { max = m }
  }
  return max
})

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
.cal-fv-feed-card.is-excluded {
  opacity: 0.55;
}
.cal-fv-feed-title-block {
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
}
.cal-fv-feed-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.cal-fv-feed-title-name {
  display: inline-flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.cal-fv-feed-title-actions {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.cal-fv-feed-osid {
  font-family: monospace;
}
.cal-fv-feed-agencies {
  cursor: pointer;
  user-select: none;
  max-height: 1.4em;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, black 80%, transparent 100%);
  mask-image: linear-gradient(to right, black 80%, transparent 100%);
}
.cal-fv-feed-agencies.is-expanded {
  max-height: none;
  -webkit-mask-image: none;
  mask-image: none;
}
</style>
