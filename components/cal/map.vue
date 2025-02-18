<template>
  <div class="cal-map-outer">
    <article class="cal-map-legend message is-dark">
      <div class="message-header">
        Legend
      </div>
      <div class="message-body">
        <div class="cal-map-legend-box">
          <div>
            <div>
              <div style="height:100%;width:100%;border:solid red 1px;" />
            </div>
            <div>Selected Area</div>
          </div>
          <div>
            <div />
            <div>Drag Markers to Adjust Area</div>
          </div>
          <div>
            <div />
            <div>
              <o-button size="small" @click="useMapExtent">
                Use map extent
              </o-button>
            </div>
          </div>
        </div>
      </div>
    </article>
    <cal-map-viewer-ts
      map-class="tall"
      :center="centerPoint"
      :zoom="14"
      :features="displayFeatures"
      :markers="bboxMarkers"
      :auto-fit="false"
      :popup-features="popupFeatures"
      @map-move="mapMove"
      @map-click-features="mapClickFeatures"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, toRaw } from 'vue'
import { type Bbox, type Feature, type PopupFeature } from '../geom'

const route = useRoute()

const emit = defineEmits([
  'setBbox',
])

const props = defineProps<{
  bbox: Bbox
  stopFeatures: Feature[]
}>()

const centerPoint = [
  (props.bbox.sw.lon + props.bbox.ne.lon) / 2,
  (props.bbox.sw.lat + props.bbox.ne.lat) / 2
]

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
      id: 'bbox',
      type: 'Feature',
      properties: {
        'fill-color': '#ccc',
        'line-color': '#ff0000',
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

const displayFeatures = computed(() => {
  const features: Feature[] = []
  for (const feature of bboxArea.value) {
    features.push(toRaw(feature))
  }
  for (const stop of props.stopFeatures) {
    const stopCopy = Object.assign({}, toRaw(stop))
    stopCopy.properties['marker-color'] = '#ff0000'
    stopCopy.properties['marker-radius'] = 10
    features.push(toRaw(stop))
  }
  return features
})

/////////////////
// Mapmove

const extentBbox = ref(null)

function mapMove (v: any) {
  const b = v.bbox
  extentBbox.value = {
    sw: { lon: b[0][0], lat: b[0][1] },
    ne: { lon: b[1][0], lat: b[1][1] }
  }
}

function useMapExtent () {
  emit('setBbox', extentBbox.value)
}

const popupFeatures = ref<PopupFeature>([])

function mapClickFeatures (features: Feature[]) {
  const a: PopupFeature[] = []
  for (const feature of features) {
    if (feature.geometry.type !== 'Point') {
      continue
    }
    a.push({
      point: { lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] },
      text: feature.properties.stop_name,
    })
  }
  popupFeatures.value = a
}
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
  padding:5px;
  height:300px;
  z-index:100;
  .message-body {
    background: hsla(var(--bulma-white-h), var(--bulma-white-s), var(--bulma-white-on-scheme-l), 0.25);
  }
  .cal-map-legend-box {
    display: flex;
    flex-direction: column;
    > div {
      display: flex;
      height:30px;
      align-items:center;
      div:first-child {
        width:20px;
        height:20px;
      }
      div:nth-child(2) {
        padding-left:10px;
      }
    }
  }

}
</style>
