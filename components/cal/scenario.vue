<template>
  <div />
</template>

<script setup lang="ts">
import { gql } from 'graphql-tag'
import { ref, watch, computed } from 'vue'
import { type Bbox, type Feature } from '../geom'
import { useQuery } from '@vue/apollo-composable'

const emit = defineEmits([
  'setStopFeatures',
  'setLoading',
  'setError',
  'setDepartureProgress'
])

const props = defineProps<{
  bbox: Bbox
}>()

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const selectedRouteTypes = defineModel<string[]>('selectedRouteTypes')
const selectedDays = defineModel<string[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')

// This prevents runaway queries
let queryCount = 0
const maxQueryLimit = 1000

/////////////////////////////
// Basic stop data
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

const { result: stopResult, loading: stopLoading, error: stopError, refetch: stopRefetch, fetchMore: stopFetchMore } = useQuery(stopQuery, stopVars, { clientId: 'transitland' })

// Handle loading and errors
watch(stopLoading, () => {
  emit('setLoading', stopLoading.value)
})
watch(stopError, () => {
  emit('setError', stopError.value)
})

// Automatically fetch more results9
let prevId = 0
watch(stopResult, () => {
  // When we have new stops available, update the cache
  updateStopDepartureCache([])

  // Check if we need to fetch more stops
  const stops = stopResult.value?.stops || []
  const nextRequestAfter = stops[stops.length - 1]?.id
  if (stops.length === 0 || nextRequestAfter === prevId) {
    stopLoading.value = false
    return
  }

  // Fetch more stops
  prevId = nextRequestAfter
  queryCount += 1
  if (queryCount > maxQueryLimit) {
    console.log('stopQuery: internal fail safe: query limit reached...')
    return
  }
  stopFetchMore({
    variables: {
      after: nextRequestAfter,
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      const newStops = fetchMoreResult?.stops || []
      return {
        stops: [...previousResult.stops || [], ...newStops]
      }
    }
  })
})

/////////////////////////////
// Stop departures
/////////////////////////////

const stopDepartureQuery = gql`
query ($ids: [Int!]) {
  stops(ids: $ids) {
    id
    departures_monday: departures(limit: 1, where: {relative_date: MONDAY}) {
      departure_time
    }
  }
}`

const stopDepartureLimit = 100
const stopDepartureVars = { ids: [] }
const { result: stopDepartureResult, loading: stopDepartureLoading, error: stopDepartureError, fetchMore: stopDepartureFetchMore } = useQuery(stopDepartureQuery, stopDepartureVars, { clientId: 'transitland' })

watch(stopDepartureError, () => {
  emit('setError', stopDepartureError.value)
})

// Stop departure queue
const stopDepartureCache = new Map<number, Record<string, any>>()
const stopDepartureQueue = ref<number[]>([])
function updateStopDepartureCache (stops: Record<string, any>[]) {
  for (const stop of stops) {
    stopDepartureCache.set(stop.id, stop)
  }
  const stopsNeedDepartures = (stopResult.value?.stops || []).filter(s => !stopDepartureCache.has(s.id)).map(s => s.id)
  stopDepartureQueue.value = stopsNeedDepartures
}

watch(stopDepartureQueue, (v: number[]) => {
  const stopIds = v.slice(0, stopDepartureLimit)
  emit('setDepartureProgress', { queue: stopDepartureQueue.value.length, total: stopResult.value.stops?.length })
  if (stopIds.length === 0) {
    return
  }

  // Update progress
  console.log('fetching departures:', stopIds)

  queryCount += 1
  if (queryCount > maxQueryLimit) {
    console.log('stopDepartureQuery: internal fail safe: query limit reached...')
    return
  }
  stopDepartureFetchMore({
    variables: {
      ids: stopIds
    },
    updateQuery: (previousResult, { fetchMoreResult }) => {
      const newStops = fetchMoreResult?.stops || []
      updateStopDepartureCache(newStops)
      return {
        stops: [...previousResult.stops || [], ...newStops]
      }
    }
  })
})

////////////////////////
// Feature processing
////////////////////////

// Create stop features
watch(stopResult, () => {
  const features: Feature[] = []
  for (const stop of (stopResult.value?.stops || [])) {
    if (stop.route_stops.length === 0) {
      continue
    }
    const stopProps = Object.assign({}, stop)
    stopProps.marked = stopFilter(stop)
    delete stopProps.geometry
    features.push({
      type: 'Feature',
      id: stop.id.toString(),
      properties: stopProps,
      geometry: stop.geometry
    })
  }
  emit('setStopFeatures', features)
})

// Filter stops
function stopFilter (stop: Record<string, any>): boolean {
  // Check departure days
  // Must have service on at least one selected day
  const sd = selectedDays.value || []
  if (sd.length > 0) {
    let found = false
    for (const day of sd) {
      if (stop[`departures_${day.toLowerCase()}`].length > 0) {
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
  const srt = selectedRouteTypes.value || []
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
  const sg = selectedAgencies.value || []
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

</script>
