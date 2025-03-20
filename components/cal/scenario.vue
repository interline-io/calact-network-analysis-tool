<template>
  <div />
</template>

<script lang="ts">
import { gql } from 'graphql-tag'

//////////
// Stops
//////////

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

// Filter stops
function stopFilter (stop: Stop, sd: string[], srt: string[], sg: string[]): boolean {
  // Check departure days
  // Must have service on at least one selected day
  // if (sd.length > 0 && stopDepartureLoadingComplete.value) {
  //     const stopDepartures = stopDepartureCache.get(stop.id) || {}
  //     let found = false
  //     for (const day of sd) {
  //         const deps = stopDepartures[`departures_${day.toLowerCase()}`] || []
  //         if (deps.length > 0) {
  //             found = true
  //             break
  //         }
  //     }
  //     if (!found) {
  //         return false
  //     }
  // }

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

//////////
// Routes
//////////

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

//////////
// Stop departures
//////////

const stopDepartureQuery = gql`
fragment departure on StopTime {
  departure_time
  trip {
    id
    direction_id
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

interface StopTime {
  departure_time: string
  trip: {
    id: number
    direction_id: number
  }
}

interface StopDeparture {
  id: number
  departures_monday: StopTime[]
  departures_tuesday: StopTime[]
  departures_wednesday: StopTime[]
  departures_thursday: StopTime[]
  departures_friday: StopTime[]
  departures_saturday: StopTime[]
  departures_sunday: StopTime[]
}

class StopDepartureQueryVars {
  ids: number[] = []
  monday: string = ''
  tuesday: string = ''
  wednesday: string = ''
  thursday: string = ''
  friday: string = ''
  saturday: string = ''
  sunday: string = ''
  include_monday: boolean = false
  include_tuesday: boolean = false
  include_wednesday: boolean = false
  include_thursday: boolean = false
  include_friday: boolean = false
  include_saturday: boolean = false
  include_sunday: boolean = false

  get (dow: string): string {
    switch (dow) {
      case 'monday':
        return this.monday
      case 'tuesday':
        return this.tuesday
      case 'wednesday':
        return this.wednesday
      case 'thursday':
        return this.thursday
      case 'friday':
        return this.friday
      case 'saturday':
        return this.saturday
      case 'sunday':
        return this.sunday
    }
    return ''
  }

  setDay (d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0:
        this.sunday = format(d, dateFmt)
        this.include_sunday = true
        break
      case 1:
        this.monday = format(d, dateFmt)
        this.include_monday = true
        break
      case 2:
        this.tuesday = format(d, dateFmt)
        this.include_tuesday = true
        break
      case 3:
        this.wednesday = format(d, dateFmt)
        this.include_wednesday = true
        break
      case 4:
        this.thursday = format(d, dateFmt)
        this.include_thursday = true
        break
      case 5:
        this.friday = format(d, dateFmt)
        this.include_friday = true
        break
      case 6:
        this.saturday = format(d, dateFmt)
        this.include_saturday = true
        break
    }
  }
}

interface StopDepartureCacheKey {
  id: number
  date: string
}

class StopDepartureCache {
  cache: Map<StopDepartureCacheKey, StopDeparture[]> = new Map()

  get (id: number, date: string): StopDeparture[] {
    return this.cache.get({ id, date }) || []
  }

  add (id: number, date: string, value: StopDeparture[]) {
    const a = this.cache.get({ id, date }) || []
    a.push(...value)
    this.cache.set({ id, date }, a)
  }
}
</script>

<script setup lang="ts">
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

const stopDepartureCache = new StopDepartureCache()

const stopLimit = 1000
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
} = useLazyQuery<{ stops: Stop[] }>(
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

const stopQueue = useTask(function*(_, task: { after: number }) {
  console.log('stopQueue:', task)
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
} = useLazyQuery<{ routes: Route[] }>(
  routeQuery,
  routeVars,
  { fetchPolicy: 'no-cache', clientId: 'transitland' }
)

watch(routeError, (v) => {
  emit('setError', v)
})

const routeQueue = useTask(function*(_, task: { after: number }) {
  console.log('routeQueue:', task)
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

// Fetch more stop departures
const stopDepartureQueue = useTask(function*(_, task: StopDepartureQueryVars) {
  // Set loading state
  if (task.ids.length === 0) {
    emit('setStopDepartureProgress', { total: 0, queue: 0 })
    stopDepartureLoadingComplete.value = false
    return
  }
  emit('setStopDepartureProgress', { total: 1, queue: 1 })
  stopDepartureLoadingComplete.value = true

  checkQueryLimit()
  console.log('stopDepartureQueue:', task)
  const check = stopDepartureLoad() || stopDepartureFetchMore({
    variables: task,
    updateQuery: () => {
      return { stops: [] }
    }
  })
  check?.then((v) => {
    // Update cache
    const stops = v?.data?.stops || v?.stops || []
    const dows = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    for (const dow of dows) {
      const dowDate = task.get(dow)
      if (!dowDate) {
        continue
      }
      for (const stop of stops) {
        const deps = stop[`departures_${dow}`] || []
        if (deps.length === 0) {
          continue
        }
        stopDepartureCache.add(stop.id, dowDate, deps)
      }
    }
    console.log('v', v)
  })
  return check
})

const selectedDateRange = computed((): Date[] => {
  // Get inclusive date range
  const sd = startDate.value || new Date()
  const ed = endDate.value || new Date()
  const dates = []
  while (sd <= ed) {
    dates.push(new Date(sd.valueOf()))
    sd.setDate(sd.getDate() + 1)
  }
  console.log('selectedDateRange:', dates)
  return dates
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
      console.log('dates:', dates, 'task:', w, stopDepartureQueue)
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
