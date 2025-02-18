<template>
  <div id="mapelem" ref="mapelem" :class="mapClass" />
</template>

<script setup lang="ts">
import { nextTick } from 'vue'
import maplibre from 'maplibre-gl'

import { ref, watch, computed, toRaw, onMounted, useTemplateRef } from 'vue'
import { useRuntimeConfig } from '#imports'
import { type Bbox, type Feature, type PopupFeature } from '../geom'
import { noLabels, labels } from 'protomaps-themes-base'

//////////////////////
// Component setup

const config = useRuntimeConfig()

const emit = defineEmits([
  'mapMove',
  'mapClick',
  'mapClickFeatures',
  'mapHoverFeatures',
  'setZoom',
])

const props = defineProps<{
  bbox?: Bbox
  features?: Feature[]
  markers?: Feature[]
  popupFeatures?: PopupFeature[]
  mapClass?: string
  autoFit?: boolean
  center?: Point
  zoom?: number
}>()

let map: maplibre.Map = null
const markerLayer = ref<maplibre.Marker[]>([])
const mapRef = useTemplateRef('mapelem')

//////////////////////
// Watchers

watch(() => props.features, (v) => {
  nextTick(() => {
    updateFeatures(v)
  })
})

watch(() => props.markers, (v) => {
  drawMarkers(v)
})

watch(() => props.popupFeatures, (v) => {
  drawPopupFeatures(v)
})

watch(() => props.features, () => {
  updateFeatures()
})

watch(() => props.center, (oldVal, newVal) => {
  if (oldVal.toString() === newVal.toString()) {
    return
  }
  map.jumpTo({ center: props.center, zoom: props.zoom })
})

watch(() => props.zoom, () => {
  map.jumpTo({ center: props.center, zoom: props.zoom })
})

//////////////////////
// Map initialization
onMounted(() => {
  initMap()
})

function initMap () {
  if (map) {
    return
  }
  const opts = {
    interactive: true,
    preserveDrawingBuffer: true,
    container: mapRef.value,
    style: {
      glyphs: 'https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf',
      version: 8,
      sources: {
        'protomaps-base': {
          type: 'vector',
          tiles: [`https://api.protomaps.com/tiles/v2/{z}/{x}/{y}.pbf?key=${config.public.protomapsApikey}`],
          maxzoom: 14,
          attribution: '<a href="https://www.transit.land/terms">Transitland</a> | <a href="https://protomaps.com">Protomaps</a> | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
      },
      layers: noLabels('protomaps-base', 'grayscale')
    }
  }
  if (props.center && props.center.length > 0) {
    opts.center = props.center
  }
  if (props.zoom) {
    opts.zoom = props.zoom
  }

  markerLayer.value = []
  map = new maplibre.Map(opts)
  map.addControl(new maplibre.FullscreenControl())
  map.addControl(new maplibre.NavigationControl())
  drawMarkers(props.markers)
  map.on('load', () => {
    createSources()
    createLayers()
    updateFeatures()
    fitFeatures()
    map.on('mousemove', mapMouseMove)
    map.on('click', mapClick)
    map.on('zoom', mapZoom)
    map.on('moveend', mapMove)
    map.resize()
  })
}

function createSources () {
  map.addSource('polygons', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map.addSource('lines', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map.addSource('points', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
}

function createLayers () {
  map.addLayer({
    id: 'polygons',
    type: 'fill',
    source: 'polygons',
    layout: {},
    paint: {
      'fill-color': ['coalesce', ['get', 'fill-color'], '#ccc'],
      'fill-opacity': 0.2
    }
  })
  map.addLayer({
    id: 'polygons-outline',
    type: 'line',
    source: 'polygons',
    layout: {},
    paint: {
      'line-width': ['coalesce', ['get', 'line-width'], 2],
      'line-color': ['coalesce', ['get', 'line-color'], '#ff0000'],
      'line-opacity': 0.2
    }
  })
  map.addLayer({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-color': ['coalesce', ['get', 'marker-color'], '#ff0000'],
      'circle-radius': ['coalesce', ['get', 'marker-radius'], 10],
      'circle-opacity': 0.4
    }
  })
  map.addLayer({
    id: 'lines',
    type: 'line',
    source: 'lines',
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#000000'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 2],
      'line-opacity': 1.0
    }
  })
  // add labels last
  for (const labelLayer of labels('protomaps-base', 'grayscale')) {
    map.addLayer(labelLayer)
  }
}

function updateFeatures () {
  if (!map) {
    return
  }
  // Check source exists
  const p = map.getSource('polygons')
  if (!p) {
    return
  }
  // Update sources
  const polygons = props.features.filter((s) => { return s.geometry.type === 'MultiPolygon' || s.geometry.type === 'Polygon' })
  const points = props.features.filter((s) => { return s.geometry.type === 'Point' })
  const lines = props.features.filter((s) => { return s.geometry.type === 'LineString' })
  map.getSource('polygons').setData({ type: 'FeatureCollection', features: polygons })
  map.getSource('lines').setData({ type: 'FeatureCollection', features: lines })
  map.getSource('points').setData({ type: 'FeatureCollection', features: points })
  fitFeatures()
}

function fitFeatures () {
  const coords = []
  for (const f of props.features) {
    const g = f.geometry
    if (g.type === 'Point') {
      coords.push(g.coordinates)
    } else if (g.type === 'LineString') {
      for (const c of g.coordinates) {
        coords.push(c)
      }
    } else if (g.type === 'Polygon') {
      for (const a of g.coordinates) {
        for (const b of a) {
          coords.push(b)
        }
      }
    } else if (g.type === 'MultiLineString') {
      for (const a of g.coordinates) {
        for (const b of a) {
          coords.push(b)
        }
      }
    }
  }
  if (props.autoFit && coords.length > 0) {
    const bounds = coords.reduce(function (bounds, coord) {
      return bounds.extend(coord)
    }, new maplibre.LngLatBounds(coords[0], coords[0]))
    map.fitBounds(bounds, {
      duration: 0,
      padding: 20,
      maxZoom: 14
    })
  }
}

//////////////////////
// Map redraw

function drawPopupFeatures (feats) {
  if (feats.length === 0) {
    return
  }
  const p = feats[0].point
  const description = feats[0].text
  new maplibre.Popup()
    .setLngLat([p.lon, p.lat])
    .setHTML(description)
    .addTo(map)
}

function drawMarkers (markers) {
  for (const m of markerLayer.value) {
    m.remove()
  }
  for (const m of markers) {
    const newMarker = new maplibre.Marker(m).setLngLat(m).addTo(map)
    if (m.onDragEnd) {
      newMarker.on('dragend', m.onDragEnd)
    }
    markerLayer.value.push(newMarker)
  }
}

//////////////////////
// Map events

function mapClick (e) {
  emit('mapClick', e)
  const features = map.queryRenderedFeatures(e.point, { layers: ['points', 'polygons', 'lines'] })
  if (features.length > 0) {
    emit('mapClickFeatures', features)
  }
}

function mapZoom () {
  emit('setZoom', map.getZoom())
}

function mapMove () {
  emit('mapMove', { zoom: map.getZoom(), bbox: map.getBounds().toArray() })
}

function mapMouseMove (e) {
  const features = map.queryRenderedFeatures(e.point, { layers: ['points', 'polygons', 'lines'] })
  if (features.length > 0) {
    emit('mapHoverFeatures', features)
  }
}
</script>

  <style scss>
  @import 'maplibre-gl/dist/maplibre-gl';
  .short {
    height: 600px;
  }
  .tall {
    height: calc(100vh - 60px);
  }
  </style>
