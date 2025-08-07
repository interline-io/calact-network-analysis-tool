<template>
  <div />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'

import { type Bbox, type Feature } from '~/src/geom'
import { type dow, routeTypes } from '~/src/constants'
import { StopDepartureCache } from '~/src/departure-cache'
import { type Stop } from '~/src/stop'
import { type Agency } from '~/src/agency'
import { type Route } from '~/src/route'

import { applyScenarioResultFilter, type ScenarioConfig, type ScenarioFilter } from '~/src/scenario-fetcher'

const emit = defineEmits<{
  setRouteFeatures: [value: Route[]]
  setStopFeatures: [value: Stop[]]
  setAgencyFeatures: [value: Agency[]]
  setLoading: [value: boolean]
  setStopDepartureLoadingComplete: [value: boolean]
  setError: [value: any]
  setStopDepartureProgress: [value: { total: number, queue: number }]
}>()

const bbox = defineModel<Bbox>('bbox')
const scheduleEnabled = defineModel<boolean>('scheduleEnabled', { default: true })
const runCount = defineModel<number>('runCount')
const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const startTime = defineModel<Date>('startTime')
const endTime = defineModel<Date>('endTime')
const selectedRouteTypes = defineModel<number[]>('selectedRouteTypes')
const selectedDays = defineModel<dow[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')
const selectedDayOfWeekMode = defineModel<string>('selectedDayOfWeekMode')
const selectedTimeOfDayMode = defineModel<string>('selectedTimeOfDayMode')
const frequencyUnder = defineModel<number>('frequencyUnder')
const frequencyOver = defineModel<number>('frequencyOver')
const frequencyUnderEnabled = defineModel<boolean>('frequencyUnderEnabled')
const frequencyOverEnabled = defineModel<boolean>('frequencyOverEnabled')
const geographyIds = defineModel<number[]>('geographyIds')

const scenarioConfig = computed((): ScenarioConfig => ({
  bbox: bbox.value,
  scheduleEnabled: scheduleEnabled.value,
  startDate: startDate.value,
  endDate: endDate.value,
  geographyIds: geographyIds.value,
}))
const scenarioFilter = computed((): ScenarioFilter => {
  return {
    selectedRouteTypes: selectedRouteTypes.value || [],
    selectedDays: selectedDays.value || [],
    selectedDayOfWeekMode: selectedDayOfWeekMode.value || '',
    selectedAgencies: selectedAgencies.value || [],
    startTime: startTime.value,
    endTime: endTime.value,
    frequencyUnder: (frequencyUnderEnabled.value ? frequencyUnder.value : -1) || -1,
    frequencyOver: (frequencyOverEnabled.value ? frequencyOver.value : -1) || -1,
    selectedTimeOfDayMode: selectedTimeOfDayMode.value || '',
    frequencyUnderEnabled: frequencyUnderEnabled.value || false,
    frequencyOverEnabled: frequencyOverEnabled.value || false,
  }
})

// Apply filters to routes and stops
watch(() => [
  scenarioConfig,
  scenarioFilter
], () => {
  console.log('Applying scenario filter', scenarioConfig.value, scenarioFilter.value)
  // Check defaults
  // const selectedDateRangeValue = selectedDateRange.value || []
  const filterResult = applyScenarioResultFilter(
    {
      routes: [],
      stops: [],
      feedVersions: [],
      stopDepartureCache: new StopDepartureCache(),
      isComplete: true,
    },
    scenarioConfig.value,
    scenarioFilter.value,
  )
  console.log('Filter result', filterResult)
}, { deep: true })
</script>
