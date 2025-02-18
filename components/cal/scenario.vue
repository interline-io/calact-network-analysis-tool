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
])

const props = defineProps<{
  startDate?: Date
  endDate?: Date
  bbox: Bbox
}>()

// Setup query variables
const vars = computed(() => ({
  where: { bbox: { min_lon: props.bbox.sw.lon, min_lat: props.bbox.sw.lat, max_lon: props.bbox.ne.lon, max_lat: props.bbox.ne.lat } }
}))

const query = gql`
  query ($where:StopFilter) {
    stops(where:$where) {
      id
      stop_id
      stop_name
      geometry
    }
  }`

const { result, loading, error, load, refetch } = useLazyQuery(query, null, { clientId: 'transitland' })

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
loadReload()

const stopFeatures = computed(() => {
  const features: Feature[] = []
  for (const stop of (result.value?.stops || [])) {
    features.push({
      type: 'Feature',
      id: `${stop.id}`,
      properties: {
        stop_name: stop.stop_name,
        stop_id: stop.stop_id,

      },
      geometry: stop.geometry
    })
  }
  return features
})

watch(stopFeatures, () => {
  emit('setStopFeatures', stopFeatures.value)
})
</script>
