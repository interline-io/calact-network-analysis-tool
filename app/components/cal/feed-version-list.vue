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
        <!-- Agencies can be a long list (NYC-MTA-style feeds have 30+).
             Default to a one-line clipped row with a right-edge fade as
             an affordance; click to expand. Reliable overflow detection
             isn't possible in pure CSS so the fade is shown even for
             short lists — it reads as a stylistic cue rather than a lie. -->
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
import type { FeedWithVersions } from '~~/src/tl'

const props = defineProps<{
  feed: FeedWithVersions
  domainStart: Date
  domainEnd: Date
  analysisStart?: Date | null
  analysisEnd?: Date | null
  // Picker controls. `selectable` enables the per-row radios and the Exclude
  // checkbox. `selectedFvId` is the explicit pick (null = use default). The
  // row computes its `selected` state by comparing against the effective
  // pick (explicit or active fallback).
  selectable?: boolean
  selectedFvId?: number | null
  excluded?: boolean
}>()

const emit = defineEmits<{
  (e: 'import', fvId: number): void
  (e: 'select', fvId: number): void
  (e: 'exclude', value: boolean): void
}>()

const activeFvId = computed(() => props.feed.feed_state?.feed_version?.id ?? null)

// Effective selection: explicit pick if set, otherwise fall back to active.
// Used to render the radio "checked" state — excluded feeds intentionally
// show no checked row so the user sees the feed has no FV in play.
const effectiveSelectedFvId = computed(() => {
  if (props.excluded) { return null }
  return props.selectedFvId ?? activeFvId.value
})

// Hide the redundant onestop_id chip when it's identical to the display name
// (or when the name is empty and we're already showing the onestop_id as
// the name).
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
