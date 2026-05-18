<template>
  <NuxtLayout name="default">
    <template #main>
      <div class="container is-fluid cal-fv-page">
        <cal-title title="Feed Version Browser" />

        <cat-msg variant="info">
          Browse feeds in a bounding box and their available feed versions. This page is the standalone view of
          the picker — the production entry point is the "Pick feed versions" modal on the Query tab.
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

        <cal-feed-version-picker
          :bbox="bbox"
          :analysis-start="analysisStart"
          :analysis-end="analysisEnd"
        />
      </div>
    </template>
  </NuxtLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import CalFeedVersionPicker from '~/components/cal/feed-version-picker.vue'
import { parseDate, parseBbox, type Bbox } from '~~/src/core'

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
const analysisStart = computed<Date | null>(() => parseDate(startDateString.value) || null)
const analysisEnd = computed<Date | null>(() => parseDate(endDateString.value) || null)
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
</style>
