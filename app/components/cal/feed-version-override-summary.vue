<template>
  <div v-if="overrideCount > 0" class="cal-fv-override-summary">
    <ul v-if="pickItems.length > 0" class="cal-fv-override-summary-list">
      <li v-for="item in pickItems" :key="item.onestopId">
        <strong>{{ item.feedLabel }}</strong>
        <template v-if="item.detail">
          — fetched {{ item.detail.fetched }} ·
          covers {{ item.detail.coverage }} ·
          <code>{{ item.detail.sha1Short }}</code>
        </template>
        <template v-else-if="loading">
          — loading…
        </template>
        <template v-else>
          — <span class="has-text-danger">feed version #{{ item.fvId }} not found</span>
        </template>
      </li>
    </ul>
    <p v-if="excludedList.length > 0" class="cal-fv-override-summary-excluded">
      <strong>Excluded:</strong> {{ excludedList.join(', ') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import {
  feedVersionsByIdsQuery,
  parseFvids,
  type FeedVersionSummaryRow,
} from '~~/src/tl'
import { fmtDate } from '~~/src/core'

// Quick-reference list of the active feed version overrides — enough detail
// per pick (feed, fetched date, coverage, sha1) that the user doesn't have to
// reopen the modal to recall what their query will run against.
const props = defineProps<{
  // fvids CSV — see parseFvids for the encoding.
  fvids: string
}>()

const parsed = computed(() => parseFvids(props.fvids))
const overrideCount = computed(() => parsed.value.picks.size + parsed.value.excluded.size)
const pickIds = computed(() => [...parsed.value.picks.values()])

const { result, loading } = useQuery<{ feed_versions: FeedVersionSummaryRow[] }>(
  feedVersionsByIdsQuery,
  () => ({ ids: pickIds.value }),
  () => ({ enabled: pickIds.value.length > 0 })
)

const detailById = computed<Map<number, FeedVersionSummaryRow>>(() => {
  const out = new Map<number, FeedVersionSummaryRow>()
  for (const fv of result.value?.feed_versions || []) {
    out.set(Number(fv.id), fv)
  }
  return out
})

interface PickItem {
  onestopId: string
  fvId: number
  feedLabel: string
  detail: { fetched: string, coverage: string, sha1Short: string } | null
}

const pickItems = computed<PickItem[]>(() => {
  const items: PickItem[] = []
  for (const [onestopId, fvId] of parsed.value.picks) {
    const row = detailById.value.get(fvId)
    items.push({
      onestopId,
      fvId,
      feedLabel: row?.feed?.name || onestopId,
      detail: row
        ? {
            fetched: fmtDate(row.fetched_at, 'MMM d, yyyy') || row.fetched_at,
            coverage: `${row.earliest_calendar_date} – ${row.latest_calendar_date}`,
            sha1Short: (row.sha1 || '').slice(0, 7),
          }
        : null,
    })
  }
  return items
})

const excludedList = computed(() => [...parsed.value.excluded].sort())
</script>

<style scoped>
.cal-fv-override-summary {
  font-size: 0.85rem;
  color: #444;
}
.cal-fv-override-summary-list {
  list-style: disc;
  margin-left: 1.2em;
}
.cal-fv-override-summary-excluded {
  margin-top: 2px;
}
</style>
