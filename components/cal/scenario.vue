<template>
  <div />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useLazyQuery } from '@vue/apollo-composable'
import {
  ScenarioFetcher,
  applyScenarioResultFilter,
  type ScenarioConfig,
  type ScenarioFilter,
  type ScenarioData,
  type ScenarioProgress,
  type GraphQLClient
} from '~/src/scenario/scenario'
import { StopDepartureCache } from '~/src/scenario/departure-cache'
import type { Stop } from '~/src/scenario/stop'
import type { Route } from '~/src/scenario/route'
import type { dow } from '~/src/constants'
import type { Bbox } from '~/src/geom'
import type { Agency } from '~/src/scenario/agency'

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
const frequencyUnder = defineModel<number>('frequencyUnder')
const frequencyOver = defineModel<number>('frequencyOver')
const frequencyUnderEnabled = defineModel<boolean>('frequencyUnderEnabled')
const frequencyOverEnabled = defineModel<boolean>('frequencyOverEnabled')
const geographyIds = defineModel<number[]>('geographyIds')

// Computed properties for config and filter to avoid duplication
const scenarioConfig = computed((): ScenarioConfig => ({
  bbox: bbox.value,
  scheduleEnabled: scheduleEnabled.value,
  startDate: startDate.value,
  endDate: endDate.value,
  geographyIds: geographyIds.value,
  stopLimit: 100
}))

const scenarioFilter = computed((): ScenarioFilter => ({
  startTime: startTime.value,
  endTime: endTime.value,
  selectedRouteTypes: selectedRouteTypes.value || [],
  selectedDays: selectedDays.value || [],
  selectedAgencies: selectedAgencies.value || [],
  selectedDayOfWeekMode: selectedDayOfWeekMode.value || '',
  selectedTimeOfDayMode: '', // Not used in the original component
  frequencyUnder: frequencyUnder.value,
  frequencyOver: frequencyOver.value,
  frequencyUnderEnabled: frequencyUnderEnabled.value || false,
  frequencyOverEnabled: frequencyOverEnabled.value || false
}))

// Internal state for ScenarioFetcher
const scenarioData = ref<ScenarioData | null>(null)
const isLoading = ref(false)
const stopDepartureLoadingComplete = ref(false)

// Create GraphQL client adapter for Vue Apollo
const createGraphQLClientAdapter = (): GraphQLClient => {
  return {
    async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
      const { load } = useLazyQuery<T>(query, variables, {
        fetchPolicy: 'no-cache',
        clientId: 'transitland'
      })
      const result = await load()
      if (!result) {
        console.log('createGraphQLClientAdapter: no result returned from Apollo query')
        return { data: undefined }
      }
      return { data: result as T }
    }
  }
}

// Watch for changes that should trigger a new scenario fetch
watch(runCount, (v) => {
  if (v) {
    fetchScenario()
  }
})

// Scenario fetching logic
const fetchScenario = async () => {
  const config = scenarioConfig.value
  if (!config.bbox && (!config.geographyIds || config.geographyIds.length === 0)) {
    return // Need either bbox or geography IDs
  }

  try {
    isLoading.value = true
    emit('setLoading', true)
    stopDepartureLoadingComplete.value = false
    emit('setStopDepartureLoadingComplete', false)

    const client = createGraphQLClientAdapter()

    const callbacks = {
      onProgress: (progress: ScenarioProgress) => {
        emit('setLoading', progress.isLoading)
        emit('setStopDepartureProgress', progress.stopDepartureProgress)

        // Emit features early when partial data is available
        if (progress.partialData && progress.partialData.stops.length > 0) {
          // Create partial scenario data for filtering
          const partialScenarioData: ScenarioData = {
            routes: progress.partialData.routes,
            stops: progress.partialData.stops,
            feedVersions: progress.partialData.feedVersions,
            stopDepartureCache: new StopDepartureCache(),
            isComplete: false
          }

          // Apply filters to partial data and emit (without schedule-dependent features)
          const partialResult = applyScenarioResultFilter(partialScenarioData, scenarioConfig.value, scenarioFilter.value)
          emit('setRouteFeatures', partialResult.routes)
          emit('setStopFeatures', partialResult.stops)
          emit('setAgencyFeatures', partialResult.agencies)
        }

        if (progress.currentStage === 'complete') {
          stopDepartureLoadingComplete.value = true
          emit('setStopDepartureLoadingComplete', true)
        }
      },
      onComplete: (result: ScenarioData) => {
        scenarioData.value = result
        isLoading.value = false
        emit('setLoading', false)
      },
      onError: (error: any) => {
        console.error('Scenario fetch error:', error)
        emit('setError', error)
        isLoading.value = false
        emit('setLoading', false)
      }
    }

    const fetcher = new ScenarioFetcher(config, client, callbacks)
    await fetcher.fetch()
  } catch (error) {
    console.error('Scenario fetch error:', error)
    emit('setError', error)
    isLoading.value = false
    emit('setLoading', false)
  }
}

// Apply filters and emit results when data or filters change
watch(() => [
  scenarioData.value,
  endTime.value,
  frequencyOver.value,
  frequencyOverEnabled.value,
  frequencyUnder.value,
  frequencyUnderEnabled.value,
  selectedAgencies.value,
  selectedDayOfWeekMode.value,
  selectedDays.value,
  selectedRouteTypes.value,
  startTime.value,
  stopDepartureLoadingComplete.value,
], () => {
  if (!scenarioData.value || !stopDepartureLoadingComplete.value) {
    return
  }

  const result = applyScenarioResultFilter(scenarioData.value, scenarioConfig.value, scenarioFilter.value)

  emit('setRouteFeatures', result.routes)
  emit('setStopFeatures', result.stops)
  emit('setAgencyFeatures', result.agencies)
})
</script>
