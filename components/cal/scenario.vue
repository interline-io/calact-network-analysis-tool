<template>
  <div />
</template>

<script setup lang="ts">
import { gql } from 'graphql-tag'
import { ref, watch, computed, toRaw } from 'vue'
import { type Bbox, type Feature } from '../geom'
import { dowValues, routeTypeColorMap } from '../constants'
import { useQuery, useLazyQuery } from '@vue/apollo-composable'

const emit = defineEmits([
  'setStopFeatures',
  'setLoading',
  'setError',
  'setDepartureProgress',
  'setRouteFeatures'
])

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

const { load: stopLoad, result: stopResult, loading: stopLoading, error: stopError, fetchMore: stopFetchMore } = useLazyQuery(stopQuery, stopVars, { fetchPolicy: 'no-cache', clientId: 'transitland' })

watch(ready, (v) => {
  if (v) {
    stopLoad()
    routeLoad()
  }
})

// Handle loading and errors
watch(stopLoading, (v) => {
  emit('setLoading', v)
})
watch(stopError, (v) => {
  emit('setError', v)
})
watch(stopResult, (v) => {
  updateStops(v.stops || [], [])
})

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

const { load: routeLoad, result: routeResult, loading: routeLoading, error: routeError, fetchMore: routeFetchMore } = useLazyQuery(routeQuery, routeVars, { fetchPolicy: 'no-cache', clientId: 'transitland' })

watch(routeResult, (v) => {
  updateRoutes(v.routes || [])
})

let prevRouteAfter = 0
function updateRoutes (routes: Record<string, any>[]) {
  const routeIds = routes.map(s => s.id)

  // Do we need to fetch more routes?
  const nextRouteAfter = routeIds[routeIds.length - 1]
  if (routeIds.length === 0 || nextRouteAfter === prevRouteAfter) {
    // No, set loading to false
    routeLoading.value = false
  } else {
    // Fetch more routes
    prevRouteAfter = nextRouteAfter
    checkQueryLimit()
    routeFetchMore({
      variables: {
        after: nextRouteAfter,
      },
      updateQuery: (previousResult, { fetchMoreResult }) => {
        const newRoutes = [...previousResult.routes || [], ...fetchMoreResult?.routes || []]
        updateRoutes(newRoutes)
        return { routes: newRoutes }
      }
    })
  }
}

watch(routeError, (v) => {
  emit('setError', v)
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
    departures_tuesday: departures(limit: 1, where: {relative_date: TUESDAY}) {
      departure_time
    }
    departures_wednesday: departures(limit: 1, where: {relative_date: WEDNESDAY}) {
      departure_time
    }
    departures_thursday: departures(limit: 1, where: {relative_date: THURSDAY}) {
      departure_time
    }
    departures_friday: departures(limit: 1, where: {relative_date: FRIDAY}) {
      departure_time
    }
    departures_saturday: departures(limit: 1, where: {relative_date: SATURDAY}) {
      departure_time
    }
    departures_sunday: departures(limit: 1, where: {relative_date: SUNDAY}) {
      departure_time
    }    
  }
}`

const stopDepartureVars = { ids: Array<number>() }
const { error: stopDepartureError, fetchMore: stopDepartureFetchMore } = useQuery(stopDepartureQuery, stopDepartureVars, { fetchPolicy: 'no-cache', clientId: 'transitland' })

watch(stopDepartureError, (v) => {
  emit('setError', v)
})

const stopDepartureCache = new Map<number, Record<string, any>>()

/////////////////////////////////
// Stop handlers
/////////////////////////////////

let prevStopAfter = 0
function updateStops (stops: Record<string, any>[], stopDepartures: Record<string, any>[]) {
  const stopIds = stops.map(s => s.id)

  // Do we need to fetch more stops?
  const nextStopAfter = stopIds[stopIds.length - 1]
  if (stops.length === 0 || nextStopAfter === prevStopAfter) {
    // No, set loading to false
    stopLoading.value = false
  } else {
    // Fetch more stops
    prevStopAfter = nextStopAfter
    checkQueryLimit()
    stopFetchMore({
      variables: {
        after: nextStopAfter,
      },
      updateQuery: (previousResult, { fetchMoreResult }) => {
        const newStops = [...previousResult.stops || [], ...fetchMoreResult?.stops || []]
        updateStops(newStops, [])
        return { stops: newStops }
      }
    })
  }

  // Update stop departures cache
  for (const stop of stopDepartures) {
    // console.log('updating stop Departures', stop)
    stopDepartureCache.set(stop.id, toRaw(stop))
  }

  // Update the list of stops that need departures
  const stopsNeedDepartures = stopIds.filter((id) => { return !stopDepartureCache.has(id) })
  emit('setDepartureProgress', {
    queue: stopsNeedDepartures.length,
    total: stops.length || 0
  })
  if (stopsNeedDepartures.length > 0) {
    const toFetch = stopsNeedDepartures.slice(0, stopDepartureLimit)
    console.log('fetching departures:', toFetch.length)
    checkQueryLimit()
    stopDepartureFetchMore({
      variables: { ids: toFetch },
      updateQuery: (previousResult, { fetchMoreResult }) => {
        const newDeps = [...previousResult.stops || [], ...fetchMoreResult?.stops || []]
        // Don't keep result, just use it to update the cache
        updateStops(stopResult.value?.stops || [], newDeps)
        return { stops: [] }
      }
    })
  }

  // Update stop features
  updateStopFeatures(stops)
}

const stopFeatures = ref<Feature[]>([])

// Merge together stop and departure data
function updateStopFeatures (stops: Record<string, any>[]) {
  const features: Feature[] = []
  for (const stop of (stops || [])) {
    if (stop.route_stops.length === 0) {
      continue
    }
    // Merge in dow values
    const stopDow = stopDepartureCache.get(stop.id) || {}
    const dowProps: Record<string, any> = {}
    for (const dow of dowValues) {
      dowProps[`departures_${dow.toLowerCase()}`] = stopDow[`departures_${dow.toLowerCase()}`] || []
    }
    const stopProps = Object.assign({}, stop, { marked: true }, dowProps)
    delete stopProps.geometry
    features.push({
      type: 'Feature',
      id: stop.id.toString(),
      properties: stopProps,
      geometry: stop.geometry
    })
  }
  stopFeatures.value = features
}

// Filtered stop features
watch(() => [stopFeatures.value, selectedDays.value, selectedRouteTypes.value, selectedAgencies.value], () => {
  for (const stop of stopFeatures.value || []) {
    stop.properties.marked = stopFilter(stop.properties)
  }
  emit('setStopFeatures', stopFeatures.value)
})

// Filter stops
function stopFilter (stop: Record<string, any>): boolean {
  // Check departure days
  // Must have service on at least one selected day
  const sd = selectedDays.value || []
  if (sd.length > 0) {
    let found = false
    for (const day of sd) {
      const deps = stop[`departures_${day.toLowerCase()}`] || []
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

/////////////////////////////////
// Route handling
/////////////////////////////////

// Filter route features
watch(() => [routeResult.value, selectedRouteTypes.value, selectedAgencies.value], () => {
  const features: Feature[] = []
  for (const route of routeResult?.value?.routes || []) {
    const routeProps = Object.assign({}, route, { marked: routeFilter(route) })
    delete routeProps.geometry
    features.push({
      type: 'Feature',
      id: route.id.toString(),
      properties: routeProps,
      geometry: route.geometry
    })
  }
  emit('setRouteFeatures', features)
})

// Filter routes
function routeFilter (route: Record<string, any>): boolean {
  // Check route types
  const srt = selectedRouteTypes.value || []
  if (srt.length > 0) {
    return srt.includes(route.route_type.toString())
  }

  // Check agencies
  const sg = selectedAgencies.value || []
  if (sg.length > 0) {
    return sg.includes(route.agency.agency_name)
  }

  // Default is to return true
  return true
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
