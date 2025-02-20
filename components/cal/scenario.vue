<template>
  <div />
</template>

<script setup lang="ts">
import { gql } from 'graphql-tag'
import { ref, watch, computed } from 'vue'
import { type Bbox, type Feature } from '../geom'
import { useLazyQuery } from '@vue/apollo-composable'

const emit = defineEmits([
  'setStopFeatures',
  'setLoading',
  'setError',
])

const props = defineProps<{
  startDate?: Date
  endDate?: Date
  bbox: Bbox
  selectedRouteTypes: string[]
  selectedDays: string[]
  selectedAgencies: string[]
}>()

// Setup query variables
const vars = computed(() => ({
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

const query = gql`
fragment deps on StopTime {
  departure {
        scheduled
        scheduled_local
        scheduled_unix
        scheduled_utc
      }
}

query ($where: StopFilter) {
  stops(where: $where) {
    id
    stop_id
    stop_name
    geometry
    departures_monday: departures(limit: 1000, where: {relative_date: MONDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_tuesday: departures(limit: 1000, where: {relative_date: TUESDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_wednesday: departures(limit: 1000, where: {relative_date: WEDNESDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_thursday: departures(limit: 1000, where: {relative_date: THURSDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_friday: departures(limit: 1000, where: {relative_date: FRIDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_saturday: departures(limit: 1000, where: {relative_date: SATURDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }    
    departures_sunday: departures(limit: 1000, where: {relative_date: SUNDAY, start: "00:00:00", end: "23:59:59"}) {
      ...deps
    }
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

const { result, loading, error, load, refetch } = useLazyQuery(query, {}, { clientId: 'transitland' })

// Watch for changes
const loadReady = computed(() => {
  return props.bbox
})

function loadReload () {
  if (loadReady.value) {
    load(query, vars.value) || refetch(vars.value)
  }
}

watch(vars, loadReload)
watch(loading, () => {
  emit('setLoading', loading.value)
})
watch(error, () => {
  emit('setError', error.value)
})
loadReload()

const stopFeatures = computed(() => {
  const features: Feature[] = []
  for (const stop of (result.value?.stops || [])) {
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
  return features
})

watch(stopFeatures, () => {
  emit('setStopFeatures', stopFeatures.value)
})

function stopFilter (stop: Record<string, any>): boolean {
  // Check departure days
  // Must have service for ALL selected days
  if (props.selectedDays.length > 0) {
    let found = true
    for (const day of props.selectedDays) {
      if (stop[`departures_${day.toLowerCase()}`].length === 0) {
        found = false
      }
    }
    if (!found) {
      return false
    }
  }

  // Check route types
  // Must match at least one route type
  if (props.selectedRouteTypes.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (props.selectedRouteTypes.includes(rs.route.route_type.toString())) {
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
  if (props.selectedAgencies.length > 0) {
    let found = false
    for (const rs of stop.route_stops) {
      if (props.selectedAgencies.includes(rs.route.agency.agency_name)) {
        found = true
        break
      }
    }
    if (!found) {
      return false
    }
  }
  return true
}

</script>
