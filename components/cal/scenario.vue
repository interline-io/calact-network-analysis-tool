<template>
  <div />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { type Bbox } from '../geom'
import { useLazyQuery } from '@vue/apollo-composable'
import { useTask } from 'vue-concurrency'
import { type dow, routeTypes } from '../constants'
import { format } from 'date-fns'

import {
  type StopDeparture,
  StopDepartureQueryVars,
  stopDepartureQuery
} from '../departure'
import {
  StopDepartureCache
} from '../departure-cache'

import {
  type Stop,
  type StopGql,
  stopQuery,
  stopSetDerived
} from '../stop'

import {
  type Route,
  type RouteGql,
  routeSetDerived,
  routeQuery,
  newRouteHeadwaySummary
} from '../route'

const emit = defineEmits<{
  setRouteFeatures: [value: Route[]]
  setStopFeatures: [value: Stop[]]
  setLoading: [value: boolean]
  setStopDepartureLoadingComplete: [value: boolean]
  setError: [value: any]
  setStopDepartureProgress: [value: { total: number, queue: number }]
}>()

const props = defineProps<{
  bbox: Bbox
  scheduleEnabled: boolean
}>()

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

const stopLimit = 1000
const stopDepartureCache = new StopDepartureCache()
const stopDepartureLoadingComplete = ref(false)
watch(stopDepartureLoadingComplete, (v) => {
  emit('setStopDepartureLoadingComplete', v)
})

watch(runCount, (v) => {
  if (v) {
    stopQueue.perform({ after: 0 })
    routeQueue.perform({ after: 0 })
  }
})

const selectedDateRange = computed((): Date[] => {
  // Get inclusive date range
  const sd = new Date((startDate.value || new Date()).valueOf())
  let ed = new Date((endDate.value || new Date()).valueOf())
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  return dates
})

/////////////////////////////
// Stops
/////////////////////////////

const stopVars = computed(() => ({
  after: 0,
  limit: stopLimit,
  where: {
    location_type: 0,
    bbox: {
      min_lon: props.bbox.sw.lon,
      min_lat: props.bbox.sw.lat,
      max_lon: props.bbox.ne.lon,
      max_lat: props.bbox.ne.lat
    }
  }
}))

const {
  load: stopLoad,
  result: stopResult,
  loading: stopLoading,
  error: stopError,
  fetchMore: stopFetchMore
} = useLazyQuery<{ stops: StopGql[] }>(
  stopQuery,
  stopVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(stopLoading, (v) => {
  emit('setLoading', v)
})

watch(stopError, (v) => {
  emit('setError', v)
})

// Stop queue
const stopQueue = useTask(function* (_, task: { after: number }) {
  console.log('stopQueue: run', task)
  checkQueryLimit()
  const check = stopLoad() || stopFetchMore({
    variables: {
      after: task.after,
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      return {
        stops: [...previousResult?.stops || [], ...fetchMoreResult?.stops || []]
      }
    }
  })
  check?.then((v) => {
    const ids = (v?.data?.stops || v?.stops || []).map(s => (s.id))
    enqueueStopDepartureFetch(ids)
    if (ids.length > 0) {
      stopQueue.enqueue().maxConcurrency(1).perform({ after: ids[ids.length - 1] })
    }
  })
})

/////////////////////////////
// Routes
/////////////////////////////

const routeVars = computed(() => ({
  after: 0,
  limit: 100,
  where: {
    bbox: {
      min_lon: props.bbox.sw.lon,
      min_lat: props.bbox.sw.lat,
      max_lon: props.bbox.ne.lon,
      max_lat: props.bbox.ne.lat
    }
  }
}))

const {
  load: routeLoad,
  result: routeResult,
  loading: routeLoading,
  error: routeError,
  fetchMore: routeFetchMore
} = useLazyQuery<{ routes: RouteGql[] }>(
  routeQuery,
  routeVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(routeError, (v) => {
  emit('setError', v)
})

const routeQueue = useTask(function* (_, task: { after: number }) {
  console.log('routeQueue: run', task)
  checkQueryLimit()
  const check = routeLoad() || routeFetchMore({
    variables: {
      after: task.after,
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      const newRoutes = [...previousResult.routes || [], ...fetchMoreResult?.routes || []]
      return { routes: newRoutes }
    }
  })
  check?.then((v) => {
    const ids = (v?.data?.routes || v?.routes || []).map(s => (s.id))
    if (ids.length > 0) {
      routeQueue.enqueue().maxConcurrency(1).perform({ after: ids[ids.length - 1] })
    }
  })
})

/////////////////////////////
// Stop departures
/////////////////////////////

const {
  error: stopDepartureError,
  load: stopDepartureLoad,
  fetchMore: stopDepartureFetchMore,
  loading: stopDepartureLoading
} = useLazyQuery<{ stops: StopDeparture[] }>(
  stopDepartureQuery,
  new StopDepartureQueryVars(),
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(stopDepartureError, (v) => {
  emit('setError', v)
})

// FIXME: StopDepartureQuery.isLoading doesnt seem to work
const activeStopDepartureQueryCount = ref(0)

watch(activeStopDepartureQueryCount, (v) => {
  if (v === 0) {
    stopDepartureLoadingComplete.value = true
  }
  emit('setStopDepartureProgress', { total: 0, queue: v })
})

const dowDateStringLower = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Fetch more stop departures
const stopDepartureQueue = useTask(function* (_, task: StopDepartureQueryVars) {
  // Set loading state
  if (task.ids.length === 0) {
    return
  }
  if (!props.scheduleEnabled) {
    console.log('schedule loading disabled, skipping departure queue')
    task.ids = [0]
  }

  checkQueryLimit()
  console.log('stopDepartureQueue: run', task)
  const check = stopDepartureLoad(stopDepartureQuery, task) || stopDepartureFetchMore({
    variables: task,
    updateQuery: () => {
      return { stops: [] }
    }
  })
  check?.then((v) => {
    // Update cache
    activeStopDepartureQueryCount.value -= 1
    const stops = v?.data?.stops || v?.stops || []
    for (const dow of dowDateStringLower) {
      const dowDate = task.get(dow)
      if (!dowDate) {
        continue
      }
      for (const stop of stops) {
        const stopDepartures = stop[dow] || []
        stopDepartureCache.add(stop.id, dowDate, stopDepartures)
      }
    }
    stopDepartureCache.debugStats()
  })
  return check
})

// Break into weeks
function enqueueStopDepartureFetch (stopIds: number[]) {
  if (stopIds.length === 0) {
    // Enqueue empty task to signal complete
    stopDepartureQueue.enqueue().maxConcurrency(1).perform(new StopDepartureQueryVars())
    return
  }
  const dates = selectedDateRange.value
  const batchSize = 100
  const weekSize = 7
  for (let sid = 0; sid < stopIds.length; sid += batchSize) {
    for (let i = 0; i < dates.length; i += weekSize) {
      const w = new StopDepartureQueryVars()
      w.ids = stopIds.slice(sid, sid + batchSize)
      for (const d of dates.slice(i, i + weekSize)) {
        w.setDay(d)
      }
      activeStopDepartureQueryCount.value += 1
      stopDepartureQueue.enqueue().maxConcurrency(1).perform(w)
    }
  }
}

////////////////////////
// Route and stop filters
////////////////////////

// Apply filters to routes and stops
watch(() => [
  stopResult.value,
  routeResult.value,
  endTime.value,
  frequencyOver.value,
  frequencyOverEnabled.value,
  frequencyUnder.value,
  frequencyUnderEnabled.value,
  selectedAgencies.value,
  selectedDateRange.value,
  selectedDayOfWeekMode.value,
  selectedDays.value,
  selectedRouteTypes.value,
  startTime.value,
  stopDepartureLoadingComplete.value,
], () => {
  // Check defaults
  const selectedDayOfWeekModeValue = selectedDayOfWeekMode.value || ''
  const selectedDateRangeValue = selectedDateRange.value || []
  const selectedDaysValue = selectedDays.value || []
  const selectedRouteTypesValue = selectedRouteTypes.value || []
  const selectedAgenciesValue = selectedAgencies.value || []
  const sdCache = stopDepartureLoadingComplete.value ? stopDepartureCache : null
  const startTimeValue = startTime.value ? format(startTime.value, 'HH:mm:ss') : '00:00:00'
  const endTimeValue = endTime.value ? format(endTime.value, 'HH:mm:ss') : '24:00:00'
  const frequencyUnderValue = (frequencyUnderEnabled.value ? frequencyUnder.value : -1) || -1
  const frequencyOverValue = (frequencyOverEnabled.value ? frequencyOver.value : -1) || -1

  // Apply route filters
  const routeFeatures: Route[] = []
  for (const routeGql of routeResult.value?.routes || []) {
    const route: Route = {
      ...routeGql,
      route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
      agency_name: routeGql.agency?.agency_name || 'Unknown',
      mode: routeTypes.get(routeGql.route_type) || 'Unknown',
      marked: true,
      average_frequency: -1,
      fastest_frequency: -1,
      slowest_frequency: -1,
      headways: newRouteHeadwaySummary(),
    }
    routeSetDerived(
      route,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      sdCache,
    )
    routeFeatures.push(route)
  }
  emit('setRouteFeatures', routeFeatures)

  // Memoize selected routes
  const markedRoutes = new Set(routeFeatures.filter(r => r.marked).map(r => r.id))

  // Apply stop filters
  const stopFeatures: Stop[] = []
  for (const stopGql of (stopResult.value?.stops || [])) {
    const stop: Stop = {
      ...stopGql,
      marked: true,
      visits: null,
    }
    stopSetDerived(
      stop,
      selectedDaysValue,
      selectedDayOfWeekModeValue,
      selectedDateRangeValue,
      startTimeValue,
      endTimeValue,
      selectedRouteTypesValue,
      selectedAgenciesValue,
      frequencyUnderValue,
      frequencyOverValue,
      markedRoutes,
      sdCache
    )
    stopFeatures.push(stop)
  }
  emit('setStopFeatures', stopFeatures)
})

////////////////////////
// Helpers
///////////////////////

let queryCount = 0
const maxQueryLimit = 10000
function checkQueryLimit () {
  queryCount += 1
  if (queryCount > maxQueryLimit) {
    console.log('Query limit exceeded')
  }
}

</script>
