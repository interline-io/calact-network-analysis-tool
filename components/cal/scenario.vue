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
])

const props = defineProps<{
  bbox: Bbox
}>()

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const selectedRouteTypes = defineModel<string[]>('selectedRouteTypes')
const selectedDays = defineModel<string[]>('selectedDays')
const selectedAgencies = defineModel<string[]>('selectedAgencies')

// Setup query variables

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

const { result, loading, error, refetch } = useQuery(query, vars, { clientId: 'transitland' })

// Handle loading and errors
emit('setLoading', loading.value)
watch(loading, () => {
  emit('setLoading', loading.value)
})
watch(error, () => {
  emit('setError', error.value)
})

// Handle resutls
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
