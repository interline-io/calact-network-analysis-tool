<template>
  <!-- A route also shows how the Routes report works out its numbers. -->
  <cat-tabs v-if="route" v-model="tab" type="boxed">
    <cat-tab-item value="trips" label="Trips">
      <cal-trip-report v-bind="reportProps" @retry="$emit('retry')" />
    </cat-tab-item>
    <cat-tab-item value="frequency" label="Calculations">
      <cal-route-frequency v-if="tab === 'frequency'" v-bind="frequencyProps" tab="frequency" />
    </cat-tab-item>
    <cat-tab-item value="stops" label="Stop Details">
      <cal-route-frequency v-if="tab === 'stops'" v-bind="frequencyProps" tab="stops" />
    </cat-tab-item>
  </cat-tabs>
  <cal-trip-report v-else v-bind="reportProps" @retry="$emit('retry')" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScenarioFilterResult, TripSubject, TripTableRow } from '~~/src/scenario'
import type { Weekday, WeekdayMode } from '~~/src/core'
import type { Route } from '~~/src/tl'

// The full-size view of a stop's, cluster's, or route's trips: the trip table,
// and for a route its calculation and stop details too.
export type TripDetailsTab = 'trips' | 'frequency' | 'stops'

const props = defineProps<{
  subjectKind: TripSubject['kind']
  rows: TripTableRow[]
  multiDay: boolean
  title: string
  detailsLoading: boolean
  detailsError: string | null
  // A route subject's route; its tabs need the scenario and filters too.
  route?: Route
  scenarioFilterResult?: ScenarioFilterResult
  selectedDateRange: Date[]
  selectedWeekdays?: Weekday[]
  selectedWeekdayMode?: WeekdayMode
  startTime?: Date
  endTime?: Date
}>()

defineEmits<{
  retry: []
}>()

const tab = defineModel<TripDetailsTab>('tab', { default: 'trips' })

const reportProps = computed(() => ({
  subjectKind: props.subjectKind,
  rows: props.rows,
  multiDay: props.multiDay,
  title: props.title,
  detailsLoading: props.detailsLoading,
  detailsError: props.detailsError,
}))

const frequencyProps = computed(() => ({
  route: props.route!,
  scenarioFilterResult: props.scenarioFilterResult!,
  selectedDateRange: props.selectedDateRange,
  selectedWeekdays: props.selectedWeekdays,
  selectedWeekdayMode: props.selectedWeekdayMode,
  startTime: props.startTime,
  endTime: props.endTime,
}))
</script>
