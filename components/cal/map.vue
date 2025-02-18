<template>
  <div class="cal-map-outer">
    <article class="cal-map-legend message is-dark">
      <div class="message-header">
        Legend
      </div>
      <div class="message-body">
        <div class="is-flex mb-2">
          <div class="is-flex">
            <div class="mr-2" style="width:20px;height:20px;background:#ff0000;" />
            <div>Selected Area</div>
          </div>
        </div>
        <div class="is-flex mb-2">
          <div class="is-flex">
            <div class="mr-2" style="width:20px;height:20px;border:2px solid #ff0000;" />
            <div>Drag Markers to Adjust Area</div>
          </div>
        </div>
      </div>
    </article>
    <tl-map-viewer
      :center="centerPoint"
      map-class="tall"
      :zoom="10"
      :features="bboxArea"
      :markers="bboxMarkers"
      :enable-scroll-zoom="true"
      :auto-fit="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { type Bbox, type Feature } from '../geom'

const emit = defineEmits([
  'setBbox',
])

const route = useRoute()

const props = defineProps<{
  startDate?: Date
  endDate?: Date
  bbox: Bbox
}>()

const centerPoint = computed(() => {
  return [
    (props.bbox.sw.lon + props.bbox.ne.lon) / 2,
    (props.bbox.sw.lat + props.bbox.ne.lat) / 2
  ]
})

const bboxArea = computed(() => {
  const f: Feature[] = []
  if (props.bbox.valid) {
    const p = props.bbox
    const coords = [[
      [p.sw.lon, p.sw.lat],
      [p.sw.lon, p.ne.lat],
      [p.ne.lon, p.ne.lat],
      [p.ne.lon, p.sw.lat],
      [p.sw.lon, p.sw.lat]
    ]]
    f.push({
      id: '',
      type: 'Feature',
      properties: {
        'fill-color': '#ff0000'
      },
      geometry: { type: 'Polygon', coordinates: coords }
    })
  }
  return f
})

const bboxMarkers = computed(() => {
  const ret = []
  ret.push({
    lng: props.bbox.sw.lon,
    lat: props.bbox.sw.lat,
    color: '#ff0000',
    label: 'SW',
    draggable: true,
    onDragEnd: (c: any) => {
      emit('setBbox', {
        ne: props.bbox.ne,
        sw: {
          lon: c.target.getLngLat().lng,
          lat: c.target.getLngLat().lat,
        }
      })
    }
  })
  ret.push({
    lng: props.bbox.ne.lon,
    lat: props.bbox.ne.lat,
    color: '#00ff00',
    label: 'NE',
    draggable: true,
    onDragEnd: (c: any) => {
      emit('setBbox', {
        sw: props.bbox.sw,
        ne: {
          lon: c.target.getLngLat().lng,
          lat: c.target.getLngLat().lat,
        }
      })
    }
  })
  return ret
})

</script>

<style scoped lang="scss">
.cal-map-outer {
  position:relative;
}
.cal-map-legend {
  position:absolute;
  right:50px;
  bottom:50px;
  width:300px;
  color:black;
  padding:10px;
  height:300px;
  z-index:100;
  .message-body {
    background: hsla(var(--bulma-white-h), var(--bulma-white-s), var(--bulma-white-on-scheme-l), 0.25);
  }

}
</style>
