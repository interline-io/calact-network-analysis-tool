<template>
  <div />
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { Bbox, Feature } from '~/src/geom'
import { useLazyQuery } from '@vue/apollo-composable'
import { useTask } from 'vue-concurrency'
import { type dow, routeTypes } from '~/src/constants'
import { format } from 'date-fns'

import {
  type StopDeparture,
  type StopTime,
  StopDepartureQueryVars,
  stopDepartureQuery
} from '~/src/departure'
import {
  StopDepartureCache
} from '~/src/departure-cache'

import {
  type Stop,
  type StopGql,
  stopQuery,
  stopSetDerived
} from '~/src/stop'

import type {
  Agency
} from '~/src/agency'

import {
  type Route,
  type RouteGql,
  routeSetDerived,
  routeQuery,
  newRouteHeadwaySummary
} from '~/src/route'

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

const stopLimit = 100
const stopTimeBatchSize = 100
const stopDepartureCache = new StopDepartureCache()
const stopDepartureLoadingComplete = ref(false)
watch(stopDepartureLoadingComplete, (v) => {
  emit('setStopDepartureLoadingComplete', v)
})

watch(runCount, (v) => {
  if (v) {
    stopQueue.perform({ after: 0 })
  }
})

const selectedDateRange = computed((): Date[] => {
  // Get inclusive date range
  const sd = new Date((startDate.value || new Date()).valueOf())
  const ed = new Date((endDate.value || new Date()).valueOf())
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

const stopVars = computed(() => {
  const b = bbox.value == null
    ? null
    : {
        min_lon: bbox.value.sw.lon,
        min_lat: bbox.value.sw.lat,
        max_lon: bbox.value.ne.lon,
        max_lat: bbox.value.ne.lat
      }

  //  Allow bbox OR features
  const geoIds = geographyIds.value || []
  return {
    after: 0,
    limit: stopLimit,
    where: {
      location_type: 0,
      location: {
        bbox: geoIds.length > 0 ? null : b,
        geography_ids: geoIds.length > 0 ? geoIds : null,
      }
    }
  }
})

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
    console.log('stopQueue: resolved')
    const responseAny = v as any
    const stopData: StopGql[] = responseAny?.data?.stops || responseAny?.stops || []
    const routeIds: Set<number> = new Set()
    for (const stop of stopData) {
      for (const rs of stop.route_stops || []) {
        routeIds.add(rs.route?.id)
      }
    }
    if (routeIds.size > 0) {
      routeQueue.enqueue().maxConcurrency(1).perform({ ids: [...routeIds] })
    }

    const ids = stopData.map(s => (s.id))
    enqueueStopDepartureFetch(ids)
    if (ids.length > 0) {
      stopQueue.enqueue().maxConcurrency(1).perform({ after: ids[ids.length - 1] })
    }
  })
})

/////////////////////////////
// Routes
/////////////////////////////

const {
  load: routeLoad,
  result: routeResult,
  loading: routeLoading,
  error: routeError,
  fetchMore: routeFetchMore
} = useLazyQuery<{ routes: RouteGql[] }>(
  routeQuery,
  { ids: [] },
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(routeError, (v) => {
  emit('setError', v)
})

const routeResultFixed = ref<RouteGql[]>([])

const routeQueue = useTask(function* (_, task: { ids: number[] }) {
  console.log('routeQueue: run', task)
  checkQueryLimit()
  const currentRouteIds = new Set<number>((routeResultFixed?.value || []).map(r => r.id))
  const taskRouteIds = new Set<number>(task.ids)
  const fetchRouteIds = [...taskRouteIds.difference(currentRouteIds)]
  console.log('routeQueue: currentRouteIds:', currentRouteIds, 'taskIds:', taskRouteIds, 'fetchRouteIds', fetchRouteIds)
  const check = routeLoad(routeQuery, { ids: fetchRouteIds }) || routeFetchMore({
    variables: {
      ids: fetchRouteIds,
    },
    updateQuery: () => {
      return {
        routes: []
      }
    }
  })
  check?.then((v) => {
    console.log('routeQueue: resolved')
    const responseAny = v as any
    const routeData: RouteGql[] = responseAny?.data?.routes || responseAny?.routes || []
    const routeIdx = new Map<number, RouteGql>()
    for (const route of routeResultFixed.value || []) {
      routeIdx.set(route.id, route)
    }
    for (const route of routeData) {
      routeIdx.set(route.id, route)
    }
    console.log(
      'routeQueue: resolved',
      '\nallRouteIds:', [...routeIdx.keys()]
    )
    routeResultFixed.value = [...routeIdx.values()]
  })
  return check
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
  if (!scheduleEnabled.value) {
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
    const responseAny = v as any
    const stopData: StopDeparture[] = responseAny.data?.stops || responseAny.stops || []
    for (const dow of dowDateStringLower) {
      const dowDate = task.get(dow)
      if (!dowDate) {
        continue
      }
      for (const stop of stopData) {
        let r: StopTime[] = []
        if (dow === 'monday') { r = stop.monday || [] }
        if (dow === 'tuesday') { r = stop.tuesday || [] }
        if (dow === 'wednesday') { r = stop.wednesday || [] }
        if (dow === 'thursday') { r = stop.thursday || [] }
        if (dow === 'friday') { r = stop.friday || [] }
        if (dow === 'saturday') { r = stop.saturday || [] }
        if (dow === 'sunday') { r = stop.sunday || [] }
        stopDepartureCache.add(stop.id, dowDate, r)
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
  const weekSize = 7
  for (let sid = 0; sid < stopIds.length; sid += stopTimeBatchSize) {
    for (let i = 0; i < dates.length; i += weekSize) {
      const w = new StopDepartureQueryVars()
      w.ids = stopIds.slice(sid, sid + stopTimeBatchSize)
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
  routeResultFixed.value,
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
  geographyIds.value,
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

  /////////////////////////
  // Apply route filters
  const routeFeatures: Route[] = []
  for (const routeGql of routeResultFixed?.value || []) {
    const route: Route = {
      ...routeGql,
      route_name: routeGql.route_long_name || routeGql.route_short_name || routeGql.route_id,
      agency_name: routeGql.agency?.agency_name || 'Unknown',
      route_mode: routeTypes.get(routeGql.route_type) || 'Unknown',
      marked: true,
      average_frequency: null,
      fastest_frequency: null,
      slowest_frequency: null,
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
  const markedRoutes = new Set(routeFeatures.filter(r => r.marked).map(r => r.id))
  emit('setRouteFeatures', routeFeatures)

  /////////////////////////
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
  const markedStops = new Set(stopFeatures.filter(s => s.marked).map(s => s.id))
  emit('setStopFeatures', stopFeatures)

  /////////////////////////
  // Apply agency filters
  const agencyData = new Map()
  for (const stop of stopFeatures) {
    for (const rstop of stop.route_stops || []) {
      const agency = rstop.route.agency
      const aid = agency?.agency_id
      if (!aid) {
        continue // no valid agency listed for this stop?
      }
      const adata = agencyData.get(aid) || {
        id: aid,
        routes: new Set(),
        routes_modes: new Set(),
        stops: new Set(),
        agency: agency
      }
      adata.routes.add(rstop.route.id)
      adata.routes_modes.add(rstop.route.route_type)
      adata.stops.add(stop.id)
      agencyData.set(aid, adata)
    }
  }
  const markedAgencies: Set<number> = new Set()
  stopFeatures.filter(s => s.marked).forEach((s) => {
    for (const rstop of s.route_stops || []) {
      markedAgencies.add(rstop.route.agency?.id)
    }
  })
  routeFeatures.filter(s => s.marked).forEach((s) => {
    markedAgencies.add(s.agency?.id)
  })
  const agencyDataValues = [...agencyData.values()]
  const agencyFeatures: Agency[] = agencyDataValues.map((adata): Agency => {
    const agency = adata.agency as Agency
    return {
      marked: markedAgencies.has(agency.id),
      routes_count: adata.routes.size, // adata.routes.intersection(markedRoutes).size,
      routes_modes: [...adata.routes_modes].map(r => (routeTypes.get(r) || 'Unknown')).join(', '),
      stops_count: adata.stops.size, // adata.stops.intersection(markedStops).size,
      id: agency.id,
      agency_id: agency.agency_id,
      agency_name: agency.agency_name,
      agency_email: agency.agency_email,
      agency_fare_url: agency.agency_fare_url,
      agency_lang: agency.agency_lang,
      agency_phone: agency.agency_phone,
      agency_timezone: agency.agency_timezone,
    }
  })
  emit('setAgencyFeatures', agencyFeatures)
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
