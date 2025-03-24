<template>
  <div />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { type Bbox } from '../geom'
import { useLazyQuery } from '@vue/apollo-composable'
import { useTask } from 'vue-concurrency'
import { type StopDeparture, StopDepartureCache, StopDepartureQueryVars, stopDepartureQuery } from '../departure'
import { type Stop, type StopGql, stopQuery, stopVisits, stopSetDerived } from '../stop'
import { type Route, type RouteGql, routeFilter, routeQuery } from '../route'
import { routeTypes } from '../constants'
import { format } from 'date-fns'

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
}>()

const ready = defineModel<boolean>('ready')
const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const startTime = defineModel<Date>('startTime')
const endTime = defineModel<Date>('endTime')
const selectedRouteTypes = defineModel<string[]>('selectedRouteTypes')
const selectedDays = defineModel<string[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')
const selectedDayOfWeekMode = defineModel<string>('selectedDayOfWeekMode')
const selectedTimeOfDayMode = defineModel<string>('selectedTimeOfDayMode')

const stopLimit = 1000
const stopDepartureCache = new StopDepartureCache()
const stopDepartureLoadingComplete = ref(false)
watch(stopDepartureLoadingComplete, (v) => {
  emit('setStopDepartureLoadingComplete', v)
})

watch(ready, (v) => {
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
  console.log('selectedDateRange:', dates)
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

// Derived properties
const stopFeatures = computed((): Stop[] => {
  // Derived properties
  const features: Stop[] = (stopResult.value?.stops || []).map((s) => {
    // Gather modes at this stop
    const route_stops = s.route_stops || []
    const modes = new Set()
    for (const rstop of route_stops) {
      const rtype = rstop.route.route_type
      const mode = routeTypes.get(rtype.toString())
      if (mode) {
        modes.add(mode)
      }
    }
    return {
      ...s,
      modes: Array.from(modes).join(','),
      number_served: route_stops.length,
      average_visits: 0,
      marked: true,
      visits: stopVisits(s, [], [], null),
    }
  })
  return features
})

// Apply stop filters
watch(() => [
  stopFeatures.value,
  selectedDays.value,
  selectedRouteTypes.value,
  selectedAgencies.value,
  selectedDayOfWeekMode.value,
  selectedDateRange.value,
  stopDepartureLoadingComplete.value
], () => {
  // Apply filters
  const sd = selectedDays.value || []
  const sdMode = selectedDayOfWeekMode.value || ''
  const sdRange = selectedDateRange.value || []
  const srt = selectedRouteTypes.value || []
  const sg = selectedAgencies.value || []
  const sdCache = stopDepartureLoadingComplete.value ? stopDepartureCache : null
  const ts = startTime.value ? format(startTime.value, 'HH:mm:ss') : '00:00:00'
  const te = endTime.value ? format(endTime.value, 'HH:mm:ss') : '24:00:00'
  for (const stop of stopFeatures.value) {
    stopSetDerived(
      stop,
      sd,
      sdMode,
      sdRange,
      srt,
      sg,
      ts,
      te,
      sdCache
    )
  }
  console.log('setStopFeatures', stopFeatures.value.length)
  emit('setStopFeatures', stopFeatures.value)
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

// Derived properties
const routeFeatures = computed((): Route[] => {
  const features: Route[] = (routeResult.value?.routes || []).map(s => ({
    route_name: s.route_long_name || s.route_short_name || s.route_id,
    agency_name: s.agency?.agency_name || 'Unknown',
    mode: routeTypes.get(s.route_type.toString()) || 'Unknown',
    marked: true,
    average_frequency: 0,
    fastest_frequency: 0,
    slowest_frequency: 0,
    ...s,
  }))
  return features
})

// Apply route filter
watch(() => [
  routeFeatures.value,
  selectedRouteTypes.value,
  selectedAgencies.value
], () => {
  // Derived properties and filtering
  const srt = selectedRouteTypes.value || []
  const sg = selectedAgencies.value || []
  for (const route of routeFeatures.value) {
    route.marked = routeFilter(route, srt, sg)
  }
  console.log('setRouteFeatures', routeFeatures.value.length)
  emit('setRouteFeatures', routeFeatures.value)
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
