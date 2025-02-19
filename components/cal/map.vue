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
import { ref, computed, toRaw } from 'vue'
import { type Bbox, type Feature, type PopupFeature, type MarkerFeature } from '../geom'

const emit = defineEmits([
  'setBbox',
])

const props = defineProps<{
  bbox: Bbox
  stopFeatures: Feature[]
}>()

//////////////////
// Map geometries

// Compute initial center point; do not update
const centerPoint = {
  lon: (props.bbox.sw.lon + props.bbox.ne.lon) / 2,
  lat: (props.bbox.sw.lat + props.bbox.ne.lat) / 2
}

// Polygon for drawing bbox area
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

// Markers for bbox corners
const bboxMarkers = computed(() => {
  const ret: MarkerFeature[] = []
  ret.push({
    point: props.bbox.sw,
    color: '#ff0000',
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
    point: props.bbox.ne,
    color: '#00ff00',
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

// Lookup for stop features
// This is necessary because the geojson properties are stringified
const stopFeatureLookup = computed(() => {
  const lookup = new Map<string, Feature>()
  for (const feature of props.stopFeatures) {
    lookup.set(feature.id, toRaw(feature))
  }
  return lookup
})

// Merge features
const displayFeatures = computed(() => {
  const features: Feature[] = []
  for (const feature of bboxArea.value) {
    features.push(toRaw(feature))
  }
  for (const stop of props.stopFeatures) {
    const stopCopy = { type: 'Feature', geometry: stop.geometry, properties: {
      'marker-radius': 10,
      'marker-color': stop.properties.marked ? '#ff0000' : '#0000ff',
    }, id: stop.id }
    features.push(stopCopy)
  }
  return features
})

/////////////////
// Map events

const extentBbox = ref(props.bbox)

function mapMove (v: any) {
  const b = v.bbox
  extentBbox.value = {
    valid: true,
    sw: { lon: b[0][0], lat: b[0][1] },
    ne: { lon: b[1][0], lat: b[1][1] }
  }
}

function useMapExtent () {
  emit('setBbox', extentBbox.value)
}

const popupFeatures = ref<PopupFeature[]>([])

function mapClickFeatures (features: Feature[]) {
  const a: PopupFeature[] = []
  for (const feature of features) {
    if (!feature.id || feature.geometry.type !== 'Point') {
      continue
    }
    const stopLookup = stopFeatureLookup.value.get(feature.id.toString())
    if (!stopLookup) {
      continue
    }
    const fp = stopLookup.properties
    // FIXME
    // THIS IS TEMPORARY - THIS IS NOT SAFE
    const text = `
    Stop ID: ${fp.stop_id}<br>
    <strong>${fp.stop_name}</strong><br>
    Routes: ${fp.route_stops.map((rs: any) => rs.route.route_short_name).join(', ')}<br>
    Agencies: ${fp.route_stops.map((rs: any) => rs.route.agency.agency_name).join(', ')}
    `
    a.push({
      point: { lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] },
      text: text
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
  height:150px;
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
