<template>
  <p v-if="detailsError" class="cal-trip-report-error">
    Could not load details for some trips: {{ detailsError }}
    <cat-button size="small" class="ml-2" @click="$emit('retry')">
      Retry
    </cat-button>
  </p>
  <cal-datagrid
    :table-report="tableReport"
    :loading="detailsLoading"
    caption="Trips"
    :filename="`trips-${title}`"
  >
    <template #column-time="{ value }">
      <span class="cal-trip-report-nowrap">{{ tripTimeLabel(value) }}</span>
    </template>
    <template #column-route_short_name="{ row }">
      <cal-route-badge
        :label="row.route_short_name || row.route_long_name || row.route_id"
        :color="row.route_color"
        :text-color="row.route_text_color"
        :title="[row.route_long_name, row.agency_name].filter(Boolean).join(' · ')"
      />
    </template>
    <template #column-headsign="{ value }">
      <span v-if="value">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-trip_start="{ row }">
      <span v-if="row.trip_start" class="cal-trip-report-nowrap">
        {{ tripTimeLabel(row.trip_start) }}–{{ tripTimeLabel(row.trip_end) }}
      </span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-stop_count="{ value }">
      <span v-if="value !== ''">{{ value }}</span>
      <span v-else class="cal-trip-report-pending">{{ placeholder }}</span>
    </template>
    <template #column-days="{ value }">
      <span class="cal-trip-report-nowrap">{{ value }}</span>
    </template>
  </cal-datagrid>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { tripDetailPlaceholder, tripTableColumns, tripTimeLabel, type TripSubject, type TripTableRow } from '~~/src/scenario'
import type { TableReport } from '~~/src/core'

const props = defineProps<{
  subjectKind: TripSubject['kind']
  rows: TripTableRow[]
  multiDay: boolean
  // What the trips are for, as the download's file name.
  title: string
  detailsLoading: boolean
  detailsError: string | null
}>()

defineEmits<{
  // Fetch the details that did not arrive.
  retry: []
}>()

const tableReport = computed((): TableReport => ({
  columns: tripTableColumns(props.subjectKind, props.multiDay),
  data: props.rows,
}))

const placeholder = computed(() => tripDetailPlaceholder(props.detailsLoading))
</script>

<style scoped lang="scss">
.cal-trip-report-nowrap {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.cal-trip-report-error {
  color: var(--bulma-danger);
  margin-bottom: 1rem;
}

.cal-trip-report-pending {
  color: var(--bulma-text-weak);
}
</style>
