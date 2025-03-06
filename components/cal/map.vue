<template>
  <div class="cal-map-outer">
    <div class="cal-map-share-button">
      <o-button icon-left="share" @click="toggleShareMenu()">
        {{ showShareMenu ? 'Close' : 'Share' }}
      </o-button>
    </div>
    <article v-if="showShareMenu" class="cal-map-share message is-dark">
      <div class="message-header">
        Share
      </div>
      <div class="message-body">
        <tl-geojson-downloader :features="displayFeatures" label="Download as GeoJSON" filename="export" />
        <br><br>
        <o-button @click="copyUrlToClipboard">
          Copy URL to Clipboard
        </o-button>
      </div>
    </article>
    <article class="cal-map-legend message is-dark">
      <div class="message-header">
        Legend
      </div>
      <div class="message-body">
        <div class="cal-map-legend-box">
          <div v-if="props.displayEditBboxMode">
            <div>
              <div style="height:100%;width:100%;border:solid red 1px;" />
            </div>
            <div>Bounding Box for Query</div>
          </div>
          <div v-if="props.displayEditBboxMode">
            <div>
              <div class="legend-marker sw-marker">
                <i class="mdi mdi-arrow-bottom-left" />
              </div>
            </div>
            <div>SW Bounding Box Corner</div>
          </div>
          <div v-if="props.displayEditBboxMode">
            <div>
              <div class="legend-marker ne-marker">
                <i class="mdi mdi-arrow-top-right" />
              </div>
            </div>
            <div>NE Bounding Box Corner</div>
          </div>
          <div>
            <div style="background:#0000ff" />
            <div>Stops satisfying all filters</div>
          </div>
          <div>
            <div style="background:#000000" />
            <div>Stops not satisfying all filters</div>
          </div>
          Routes:
          <div v-for="[routeType, routeTypeColor] in routeTypeColorMap" :key="routeType">
            <div :style="{background: routeTypeColor}" />
            <div>{{ routeTypes.get(routeType) }}</div>
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
import { useToggle } from '@vueuse/core'
import { type Bbox, type Point, type Feature, type PopupFeature, type MarkerFeature } from '../geom'
import { routeTypeColorMap, routeTypes } from '../constants'
import { useToastNotification } from '#imports'

const route = useRoute()

function copyUrlToClipboard () {
  navigator.clipboard.writeText(windowUrl.value)
  useToastNotification().showToast('Copied to clipboard')
}

const emit = defineEmits([
  'setBbox',
  'setMapExtent',
])

const props = defineProps<{
  bbox: Bbox
  stopFeatures: Feature[]
  routeFeatures: Feature[]
  displayEditBboxMode?: boolean
}>()

const showShareMenu = ref(false)
const toggleShareMenu = useToggle(showShareMenu)

const windowUrl = computed(() => {
  return window.location.href
})

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
  if (props.bbox.valid && props.displayEditBboxMode) {
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

  if (!props.displayEditBboxMode) {
    return ret
  }

  // Create SW marker with custom element
  const swElement = document.createElement('div')
  swElement.className = 'custom-marker sw-marker'
  const swIconElement = document.createElement('i')
  swIconElement.className = 'mdi mdi-arrow-bottom-left'
  swElement.appendChild(swIconElement)

  ret.push({
    point: props.bbox.sw,
    color: '#ff0000',
    draggable: true,
    element: swElement,
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

  // Create NE marker with custom element
  const neElement = document.createElement('div')
  neElement.className = 'custom-marker ne-marker'
  const neIconElement = document.createElement('i')
  neIconElement.className = 'mdi mdi-arrow-top-right'
  neElement.appendChild(neIconElement)

  ret.push({
    point: props.bbox.ne,
    color: '#00ff00',
    draggable: true,
    element: neElement,
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
  const bgColor = '#666'
  const bgOpacity = 1.0
  const features: Feature[] = []
  for (const feature of bboxArea.value) {
    features.push(toRaw(feature))
  }

  const renderRoutes: Feature[] = []
  for (const route of props.routeFeatures) {
    const rp = route.properties
    const routeColor = routeTypeColorMap.get(rp.route_type.toString()) || '#000000'
    const routeProps = {
      'id': route.id,
      'stroke': rp.marked ? routeColor : bgColor,
      'stroke-width': rp.marked ? 3 : 1,
      'stroke-opacity': rp.marked ? 1 : bgOpacity,
      'route_id': rp.route_id,
      'route_type': rp.route_type,
      'route_short_name': rp.route_short_name,
      'route_long_name': rp.route_long_name,
      'agency_name': rp.agency?.agency_name,
      'agency_id': rp.agency?.agency_id,
      'marked': rp.marked,
    }
    const routeCopy = { type: 'Feature', id: route.id, geometry: route.geometry, properties: routeProps }
    renderRoutes.push(routeCopy)
  }

  const renderStops: Feature[] = []
  for (const stop of props.stopFeatures) {
    const sp = stop.properties
    const stopProps = {
      'marker-radius': sp.marked ? 8 : 4,
      'marker-color': sp.marked ? '#0000ff' : bgColor,
      'marker-opacity': sp.marked ? 1 : bgOpacity,
      'marked': sp.marked,
    }
    const stopCopy = { type: 'Feature', geometry: stop.geometry, properties: stopProps, id: stop.id }
    renderStops.push(stopCopy)
  }

  // Add unmarked routes, then unmarked stops, then marked routes, then marked stops
  features.push(...renderRoutes.filter(r => !r.properties.marked))
  features.push(...renderStops.filter(r => !r.properties.marked))
  features.push(...renderRoutes.filter(r => r.properties.marked))
  features.push(...renderStops.filter(r => r.properties.marked))
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

watch(extentBbox, () => {
  emit('setMapExtent', extentBbox.value)
})

const popupFeatures = ref<PopupFeature[]>([])

function mapClickFeatures (pt: any, features: Feature[]) {
  const a: PopupFeature[] = []
  for (const feature of features) {
    const ft = feature.geometry.type
    let text = 'Unknown feature'
    if (ft === 'Point') {
      const stopLookup = stopFeatureLookup.value.get(feature.id.toString())
      if (!stopLookup) {
        continue
      }
      const fp = stopLookup.properties
      // FIXME: THIS IS TEMPORARY - THIS IS NOT SAFE
      text = `
        Stop ID: ${fp.stop_id}<br>
        <strong>${fp.stop_name}</strong><br>
        Routes: ${fp.route_stops.map((rs: any) => rs.route.route_short_name).join(', ')}<br>
        Agencies: ${fp.route_stops.map((rs: any) => rs.route.agency.agency_name).join(', ')}`
    } else if (ft === 'LineString' || ft === 'MultiLineString') {
      const rp = feature.properties
      text = `
        Route ID: ${rp.route_id}<br>
        <strong>${rp.route_short_name || ''} ${rp.route_long_name}</strong><br>
        Type: ${routeTypes.get(rp.route_type.toString())}<br>
        Agency: ${rp.agency_name}`
    }
    a.push({
      point: { lon: pt.lng, lat: pt.lat },
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
.cal-map-share-button {
  position:absolute;
  right:50px;
  top:6px;
  z-index:100;
}
.cal-map-share {
  position:absolute;
  right:50px;
  top:50px;
  width:300px;
  color:black;
  padding:5px;
  height:150px;
  z-index:100;
}
.cal-map-legend {
  position:absolute;
  right:50px;
  bottom:220px;
  width:300px;
  color:black;
  padding:5px;
  height:150px;
  z-index:100;
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
/* Legend marker styles */
.legend-marker {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  position: relative;
  background-color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  border: 2px solid grey;
  i {
    font-size: 10px;
  }
}

.message-body {
  color: hsla(var(--bulma-text-h), var(--bulma-text-s), var(--bulma-text-l), 1.0);
  background: hsla(var(--bulma-white-h), var(--bulma-white-s), var(--bulma-scheme-main-l), 0.8);
}

/* Custom marker styles */
:deep(.custom-marker) {
  width: 24px;
  height: 24px;
  cursor: pointer;
  background-color: white;
  border: 2px solid grey;
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  display: flex;
  justify-content: center;
  align-items: center;

  i {
    font-size: 16px;
  }
}
</style>
