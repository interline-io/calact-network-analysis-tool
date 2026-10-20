<template>
  <!-- A route also shows how the Routes report works out its numbers. Each
       route tab is kept alive once opened, so switching between them does not
       rebuild its calculations. -->
  <cat-tabs v-if="route && scenarioFilterResult" v-model="tab" type="boxed">
    <cat-tab-item value="trips" label="Trips">
      <cal-trip-report v-bind="report" @retry="$emit('retry')" />
    </cat-tab-item>
    <cat-tab-item v-for="routeTab of routeTabs" :key="routeTab.value" :value="routeTab.value" :label="routeTab.label">
      <KeepAlive>
        <cal-route-frequency
          v-if="tab === routeTab.value"
          :tab="routeTab.value"
          :route="route"
          :scenario-filter-result="scenarioFilterResult"
          :selected-date-range="selectedDateRange"
          :selected-weekdays="selectedWeekdays"
          :selected-weekday-mode="selectedWeekdayMode"
          :start-time="startTime"
          :end-time="endTime"
        />
      </KeepAlive>
    </cat-tab-item>
  </cat-tabs>
  <cal-trip-report v-else v-bind="report" @retry="$emit('retry')" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ScenarioFilterResult, TripSubject, TripTableRow } from '~~/src/scenario'
import type { Weekday, WeekdayMode } from '~~/src/core'
import type { Route } from '~~/src/tl'

// The full-size view of a stop's, cluster's, or route's trips: the trip table,
// and for a route its calculations and stop details too.
export type TripDetailsTab = 'trips' | 'calculations' | 'stops'

const routeTabs: { value: Exclude<TripDetailsTab, 'trips'>, label: string }[] = [
  { value: 'calculations', label: 'Calculations' },
  { value: 'stops', label: 'Stop Details' },
]

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

// The trip table, with or without the route tabs around it.
const report = computed(() => ({
  subjectKind: props.subjectKind,
  rows: props.rows,
  multiDay: props.multiDay,
  title: props.title,
  detailsLoading: props.detailsLoading,
  detailsError: props.detailsError,
}))

const tab = defineModel<TripDetailsTab>('tab', { default: 'trips' })
</script>
