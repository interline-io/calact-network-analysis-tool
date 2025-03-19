<template>
  <div />
</template>

<script lang="ts">
export interface Stop {
  marked: boolean
  id: number
  stop_id: string
  stop_name: string
  geometry: GeoJSON.Point
  route_stops: {
    route: {
      id: number
      route_id: string
      route_type: number
      route_short_name: string
      route_long_name: string
      agency: {
        id: number
        agency_id: string
        agency_name: string
      }
    }
  }[]
}

export interface Route {
  marked: boolean
  id: number
  route_id: string
  route_short_name: string
  route_long_name: string
  route_type: number
  geometry: GeoJSON.LineString
  agency: {
    id: number
    agency_id: string
    agency_name: string
  }
}

export interface Agency {
  id: number
  agency_id: string
  agency_name: string
}

export interface StopTime {
  departure_time: string
  trip: {
    id: number
    direction_id: number
  }
}
</script>

<script setup lang="ts">
import { gql } from 'graphql-tag'
import { ref, watch, computed } from 'vue'
import { type Bbox } from '../geom'
import { useLazyQuery } from '@vue/apollo-composable'
import { format } from 'date-fns'
import { useTask } from 'vue-concurrency'

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
const selectedRouteTypes = defineModel<string[]>('selectedRouteTypes')
const selectedDays = defineModel<string[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')

const stopDepartureLimit = 100
const stopDepartureLoadingComplete = ref(false)
watch(stopDepartureLoadingComplete, (v) => {
  emit('setStopDepartureLoadingComplete', v)
})

/////////////////////////////
// Stops
/////////////////////////////

// Setup query variables
const stopQuery = gql`
query ($limit: Int, $after: Int, $where: StopFilter) {
  stops(limit: $limit, after: $after, where: $where) {
    id
    stop_id
    stop_name
    geometry
    route_stops {
      route {
        id
        route_id
        route_type
        route_short_name
        route_long_name
        agency {
          id
          agency_id
          agency_name
        }
      }
    }
  }
}`

const stopVars = computed(() => ({
  after: 0,
  limit: 1000,
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
} = useLazyQuery<{ stops: Stop[] }>(
  stopQuery,
  stopVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(ready, (v) => {
  if (v) {
    stopFetchMoreCheck()
    routeFetchMoreCheck()
  }
})

watch(stopLoading, (v) => {
  emit('setLoading', v)
})

watch(stopError, (v) => {
  emit('setError', v)
})

// Filtered stop features
watch(() => [stopResult.value, selectedDays.value, selectedRouteTypes.value, selectedAgencies.value, stopDepartureLoadingComplete.value], () => {
  const features = stopResult.value?.stops || []
  const sd = selectedDays.value || []
  const srt = selectedRouteTypes.value || []
  const sg = selectedAgencies.value || []
  for (const stop of features) {
    stop.marked = stopFilter(stop, sd, srt, sg)
  }
  console.log('setStopFeatures', features.length)
  emit('setStopFeatures', features)
})

let prevStopAfter = -1
function stopFetchMoreCheck () {
  // Do we need to fetch more stops?
  const stopIds = (stopResult.value?.stops || []).map(s => s.id)
  const nextStopAfter = stopIds[stopIds.length - 1] || 0
  if (nextStopAfter === prevStopAfter) {
    // No, set loading to false
    stopLoading.value = false
    return
  }
  // Fetch more stops
  prevStopAfter = nextStopAfter
  checkQueryLimit()
  const check = stopLoad() || stopFetchMore({
    variables: {
      after: nextStopAfter,
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      return {
        stops: [...previousResult?.stops || [], ...fetchMoreResult?.stops || []]
      }
    }
  })
  check?.then((v) => {
    const stops = v?.data?.stops || v?.stops || []
    const stopIds = stops.map(s => (s.id))
    enqueueStopDepartureFetch(stopIds)
    // stopDepartureFetchMoreCheck()
    stopFetchMoreCheck()
  })
}

// Filter stops
function stopFilter (stop: Stop, sd: string[], srt: string[], sg: string[]): boolean {
  // Check departure days
  // Must have service on at least one selected day
  if (sd.length > 0 && stopDepartureLoadingComplete.value) {
    const stopDepartures = stopDepartureCache.get(stop.id) || {}
    let found = false
    for (const day of sd) {
      const deps = stopDepartures[`departures_${day.toLowerCase()}`] || []
      if (deps.length > 0) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }

  // Check route types
  // Must match at least one route type
  if (srt.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (srt.includes(rs.route.route_type.toString())) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }

  // Check agencies
  // Must match at least one selected agency
  if (sg.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (sg.includes(rs.route.agency.agency_name)) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }

  // Default is to return true
  return true
}

/////////////////////////////
// Routes
/////////////////////////////

// Setup query variables
const routeQuery = gql`
query ($limit: Int, $after: Int, $where: RouteFilter) {
  routes(limit: $limit, after: $after, where: $where) {
    id
    route_id
    route_short_name
    route_long_name
    route_type
    geometry
    agency {
      id
      agency_id
      agency_name
    }
  }
}`

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
} = useLazyQuery<{ routes: Route[] }>(
  routeQuery,
  routeVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(routeError, (v) => {
  emit('setError', v)
})

let prevRouteAfter = -1
function routeFetchMoreCheck () {
  // Do we need to fetch more routes?
  const routeIds = (routeResult?.value?.routes || []).map(s => s.id)
  const nextRouteAfter = routeIds[routeIds.length - 1] || 0
  if (nextRouteAfter === prevRouteAfter) {
    // No, set loading to false
    routeLoading.value = false
    return
  }
  // Fetch more routes
  prevRouteAfter = nextRouteAfter
  checkQueryLimit()
  const check = routeLoad() || routeFetchMore({
    variables: {
      after: nextRouteAfter,
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      const newRoutes = [...previousResult.routes || [], ...fetchMoreResult?.routes || []]
      return { routes: newRoutes }
    }
  })
  check?.then(() => {
    routeFetchMoreCheck()
  })
}

// Filter route features
watch(() => [routeResult.value, selectedRouteTypes.value, selectedAgencies.value], () => {
  const features = routeResult.value?.routes || []
  const srt = selectedRouteTypes.value || []
  const sg = selectedAgencies.value || []
  for (const route of features) {
    route.marked = routeFilter(route, srt, sg)
  }
  console.log('setRouteFeatures', features.length)
  emit('setRouteFeatures', features)
})

// Filter routes
function routeFilter (route: Route, srt: string[], sg: string[]): boolean {
  // Check route types
  if (srt.length > 0) {
    return srt.includes(route.route_type.toString())
  }

  // Check agencies
  if (sg.length > 0) {
    return sg.includes(route.agency.agency_name)
  }

  // Default is to return true
  return true
}

/////////////////////////////
// Stop departures
/////////////////////////////

const stopDepartureQuery = gql`
fragment departure on StopTime {
  departure_time
  trip {
    id
    direction_id
    # route {
    #   id
    # }
  }
}

query (
  $ids: [Int!],
  $monday: Date,
  $tuesday: Date,
  $wednesday: Date,
  $thursday: Date,
  $friday: Date,
  $saturday: Date,
  $sunday: Date,
  $include_monday: Boolean!,
  $include_tuesday: Boolean!,
  $include_wednesday: Boolean!,
  $include_thursday: Boolean!,
  $include_friday: Boolean!,
  $include_saturday: Boolean!,
  $include_sunday: Boolean!
) {
  stops(ids: $ids) {
    id
    departures_monday: departures(limit: 1000, where: {service_date: $monday}) @include(if: $include_monday) {
      ...departure
    }
    departures_tuesday: departures(limit: 1000, where: {service_date: $tuesday}) @include(if: $include_tuesday) {
      ...departure
    }
    departures_wednesday: departures(limit: 1000, where: {service_date: $wednesday}) @include(if: $include_wednesday) {
      ...departure
    }
    departures_thursday: departures(limit: 1000, where: {service_date: $thursday}) @include(if: $include_thursday) {
      ...departure
    }
    departures_friday: departures(limit: 1000, where: {service_date: $friday}) @include(if: $include_friday) {
      ...departure
    }
    departures_saturday: departures(limit: 1000, where: {service_date: $saturday}) @include(if: $include_saturday) {
      ...departure
    }
    departures_sunday: departures(limit: 1000, where: {service_date: $sunday}) @include(if: $include_sunday) {
      ...departure
    }    
  }
}`

const stopDepartureVars = computed(() => {
  const sd = startDate.value || new Date()
  const nextWeek = new Array<string>(7)
  for (let i = 0; i < 7; i++) {
    const d = new Date(sd.valueOf())
    d.setDate(sd.getDate() + i)
    nextWeek[d.getDay()] = format(d, 'yyyy-MM-dd')
  }
  return {
    ids: [] as Number[],
    sunday: nextWeek[0],
    monday: nextWeek[1],
    tuesday: nextWeek[2],
    wednesday: nextWeek[3],
    thursday: nextWeek[4],
    friday: nextWeek[5],
    saturday: nextWeek[6],
    include_monday: true,
    include_tuesday: true,
    include_wednesday: true,
    include_thursday: true,
    include_friday: true,
    include_saturday: true,
    include_sunday: true
  }
})
const {
  error: stopDepartureError,
  load: stopDepartureLoad,
  fetchMore: stopDepartureFetchMore,
  loading: stopDepartureLoading
} = useLazyQuery<{ stops: {
  departures_monday: StopTime[]
  departures_tuesday: StopTime[]
  departures_wednesday: StopTime[]
  departures_thursday: StopTime[]
  departures_friday: StopTime[]
  departures_saturday: StopTime[]
  departures_sunday: StopTime[]
}[] }>(
  stopDepartureQuery,
  stopDepartureVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(stopDepartureError, (v) => {
  emit('setError', v)
})

interface stopDepartureKey {
  id: number
  date: string
}

const stopDepartureCache = new Map<number, Record<string, any>>()
// const stopDepartureCache = new Map<stopDepartureKey, StopDeparture[]>()

const stopDeprtureTaskManager = useTask(function*(_, w: StopDepartureFetchTask) {
  return stopDepartureFetchMoreProcess(w)
}).enqueue().maxConcurrency(1)

interface StopDepartureFetchTask {
  stopIds: number[]
  monday: string
  tuesday: string
  wednesday: string
  thursday: string
  friday: string
  saturday: string
  sunday: string
}

function enqueueStopDepartureFetch (stopIds: number[]) {
  const sd = startDate.value || new Date()

  const endDate = new Date(sd.valueOf())
  endDate.setDate(sd.getDate() + 3)

  // Get inclusive date range
  const dates = []
  while (sd < endDate) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }

  // Break into weeks
  for (let sid = 0; sid < stopIds.length; sid += 100) {
    for (let i = 0; i < dates.length; i += 7) {
      const w = {
        stopIds: stopIds.slice(sid, sid + 100),
        monday: '',
        tuesday: '',
        wednesday: '',
        thursday: '',
        friday: '',
        saturday: '',
        sunday: ''
      }
      for (const d of dates.slice(i, i + 7)) {
        switch (d.getDay()) {
          case 0: w.sunday = format(d, 'yyyy-MM-dd'); break
          case 1: w.monday = format(d, 'yyyy-MM-dd'); break
          case 2: w.tuesday = format(d, 'yyyy-MM-dd'); break
          case 3: w.wednesday = format(d, 'yyyy-MM-dd'); break
          case 4: w.thursday = format(d, 'yyyy-MM-dd'); break
          case 5: w.friday = format(d, 'yyyy-MM-dd'); break
          case 6: w.saturday = format(d, 'yyyy-MM-dd'); break
        }
      }
      console.log('week:', w)
      stopDeprtureTaskManager.enqueue().maxConcurrency(1).perform(w)
    }
  }
}

async function stopDepartureFetchMoreProcess (task: StopDepartureFetchTask) {
  // Fetch more stop departures
  if (task.stopIds.length === 0) {
    return
  }
  checkQueryLimit()
  const vars = {
    ids: task.stopIds,
    monday: task.monday,
    tuesday: task.tuesday,
    wednesday: task.wednesday,
    thursday: task.thursday,
    friday: task.friday,
    saturday: task.saturday,
    sunday: task.sunday,
    include_monday: task.monday !== '',
    include_tuesday: task.tuesday !== '',
    include_wednesday: task.wednesday !== '',
    include_thursday: task.thursday !== '',
    include_friday: task.friday !== '',
    include_saturday: task.saturday !== '',
    include_sunday: task.sunday !== ''
  }
  console.log('loading task:', task)
  const check = stopDepartureLoad() || stopDepartureFetchMore({
    variables: vars,
    updateQuery: () => {
      return { stops: [] }
    }
  })
  return check
}

function stopDepartureFetchMoreCheck () {
  if (stopDepartureLoading.value) {
    // Currently loading - wait until this is resolved
    return
  }
  // Do we need to fetch more stop departures?
  const stopIds = (stopResult.value?.stops || []).map(s => s.id)
  const stopIdsNeedDeps = []
  for (const id of stopIds) {
    if (!stopDepartureCache.has(id)) {
      stopIdsNeedDeps.push(id)
    }
  }

  // Update loading progress
  emit('setStopDepartureProgress', {
    total: stopIds.length,
    queue: stopIdsNeedDeps.length
  })

  if (stopIdsNeedDeps.length === 0) {
    // No, set loading to false
    stopDepartureLoadingComplete.value = true
    return
  }

  const sd = startDate.value || new Date()
  const nextWeek = new Array<string>(7)
  for (let i = 0; i < 7; i++) {
    const d = new Date(sd.valueOf())
    d.setDate(sd.getDate() + i)
    nextWeek[d.getDay()] = format(d, 'yyyy-MM-dd')
  }

  // Fetch more stop departures
  const fetchStopIds = stopIdsNeedDeps.slice(0, stopDepartureLimit)
  checkQueryLimit()
  const check = stopDepartureLoad() || stopDepartureFetchMore({
    variables: {
      ids: fetchStopIds,
    },
    updateQuery: () => {
      return { stops: [] }
    }
  })
  check?.then((v) => {
    const stops = v?.data?.stops || v?.stops || []
    for (const stop of stops) {
      stopDepartureCache.set(stop.id, stop)
    }
    stopDepartureFetchMoreCheck()
  })
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
