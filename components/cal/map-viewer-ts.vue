<template>
  <div id="mapelem" ref="mapelem" :class="mapClass" />
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onMounted } from 'vue'
import maplibre from 'maplibre-gl'

import { noLabels, labels } from 'protomaps-themes-base'
import type { Feature, PopupFeature, Point, MarkerFeature } from '~/src/geom'
import { useRuntimeConfig } from '#imports'

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

const overlayFeatures = defineModel<Feature[]>('overlayFeatures', { default: [] })
const features = defineModel<Feature[]>('features', { default: [] })
const markers = defineModel<MarkerFeature[]>('markers', { default: [] })
const popupFeatures = defineModel<PopupFeature[]>('popupFeatures', { default: [] })
const mapClass = defineModel<string>('mapClass', { default: 'short' })
const center = defineModel<Point>('center', { default: { lon: -122.4194, lat: 37.7749 } })
const zoom = defineModel<number>('zoom', { default: 12 })

let map: (maplibre.Map | null) = null
const markerLayer = ref<maplibre.Marker[]>([])

//////////////////////
// Watchers

watch(() => overlayFeatures.value, (v) => {
  nextTick(() => {
    updateOverlayFeatures(v)
  })
})

watch(() => markers.value, (v) => {
  drawMarkers(v)
})

watch(() => popupFeatures.value, (v) => {
  drawPopupFeatures(v)
})

watch(() => features.value, (v) => {
  updateFeatures(v)
})

watch(() => center, (oldVal, newVal) => {
  if (oldVal.toString() === newVal.toString()) {
    return
  }
  map?.jumpTo({ center: center.value, zoom: zoom.value })
})

watch(() => zoom, () => {
  map?.jumpTo({ center: center.value, zoom: zoom.value })
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
  const opts: maplibre.MapOptions = {
    interactive: true,
    container: 'mapelem',
    zoom: zoom.value,
    center: center.value,
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
  map = new maplibre.Map(opts)
  map.addControl(new maplibre.FullscreenControl())
  map.addControl(new maplibre.NavigationControl())
  drawMarkers(markers.value)
  map.on('load', () => {
    createSources()
    createLayers()
    updateOverlayFeatures(overlayFeatures.value)
    updateFeatures(features.value)
    map?.on('mousemove', mapMouseMove)
    map?.on('click', mapClick)
    map?.on('zoom', mapZoom)
    map?.on('moveend', mapMove)
    map?.resize()
  })
}

function createSources () {
  map?.addSource('overlayPolygons', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('lines', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('points', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('polygons', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
}

function createLayers () {
  for (const labelLayer of labels('protomaps-base', 'grayscale')) {
    map?.addLayer(labelLayer)
  }
  map?.addLayer({
    id: 'polygons',
    type: 'fill',
    source: 'polygons',
    layout: {},
    paint: {
      'fill-color': ['coalesce', ['get', 'fill'], '#000000'],
      'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.1],
    }
  })
  map?.addLayer({
    id: 'polygons-outline',
    type: 'line',
    source: 'polygons',
    layout: {},
    paint: {
      'line-width': ['coalesce', ['get', 'stroke-width'], 2],
      'line-color': ['coalesce', ['get', 'stroke'], '#000000'],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1.0],
    }
  })
  map?.addLayer({
    id: 'overlay-polygons',
    type: 'fill',
    source: 'overlayPolygons',
    layout: {},
    paint: {
      'fill-color': '#ccc',
      'fill-opacity': 0.3
    }
  })
  map?.addLayer({
    id: 'overlay-polygons-outline',
    type: 'line',
    source: 'overlayPolygons',
    layout: {},
    paint: {
      'line-width': 2,
      'line-color': '#ff0000',
      'line-opacity': 0.6
    }
  })
  map?.addLayer({
    id: 'lines',
    type: 'line',
    source: 'lines',
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#000000'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 2],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 1.0],
    }
  })
  map?.addLayer({
    id: 'points',
    type: 'circle',
    source: 'points',
    paint: {
      'circle-color': ['coalesce', ['get', 'marker-color'], '#ff0000'],
      'circle-radius': ['coalesce', ['get', 'marker-radius'], 10],
      'circle-opacity': ['coalesce', ['get', 'marker-opacity'], 1.0],
    }
  })
}

function updateOverlayFeatures (features: Feature[]) {
  if (!map) {
    return
  }
  // Check source exists
  const p = map.getSource('overlayPolygons')
  if (!p) {
    return
  }
  if (!map) {
    return
  }
  // Update sources
  const polygonSource = map.getSource('overlayPolygons') as maplibre.GeoJSONSource
  if (polygonSource) {
    const polygons = features.filter((s) => { return s.geometry?.type === 'MultiPolygon' || s.geometry?.type === 'Polygon' })
    polygonSource.setData({ type: 'FeatureCollection', features: polygons })
  }
  fitFeatures(features)
}

function updateFeatures (features: Feature[]) {
  if (!map) {
    return
  }
  // Check source exists
  const p = map.getSource('lines')
  if (!p) {
    return
  }
  if (!map) {
    return
  }
  // Update sources
  const points = features.filter((s) => { return s.geometry?.type === 'Point' })
  const lines = features.filter((s) => { return s.geometry?.type === 'LineString' || s.geometry?.type === 'MultiLineString' })
  const polygons = features.filter((s) => { return s.geometry?.type === 'Polygon' || s.geometry?.type === 'MultiPolygon' })
  const lineSource = map.getSource('lines') as maplibre.GeoJSONSource
  const pointSource = map.getSource('points') as maplibre.GeoJSONSource
  const polygonSource = map.getSource('polygons') as maplibre.GeoJSONSource
  if (lineSource) {
    lineSource.setData({ type: 'FeatureCollection', features: lines })
  }
  if (pointSource) {
    pointSource.setData({ type: 'FeatureCollection', features: points })
  }
  if (polygonSource) {
    polygonSource.setData({ type: 'FeatureCollection', features: polygons })
  }
}

function fitFeatures (features: Feature[]) {
  const coords = []
  for (const f of features) {
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
    } else if (g.type === 'MultiPolygon') {
      for (const a of g.coordinates) {
        for (const b of a) {
          for (const c of b) {
            coords.push(c)
          }
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
  if (coords.length > 0) {
    const bounds = coords.reduce(function (bounds, coord) {
      return bounds.extend(coord)
    }, new maplibre.LngLatBounds(coords[0], coords[0]))
    map?.fitBounds(bounds, {
      duration: 0,
      padding: 20,
      maxZoom: 14
    })
  }
}

//////////////////////
// Map redraw

function drawPopupFeatures (features: PopupFeature[]) {
  // TODO: FIXME
  // HTML is not escaped
  if (features.length === 0) {
    return
  }
  const p = features[0].point
  const description = features[0].text
  new maplibre.Popup()
    .setLngLat([p.lon, p.lat])
    .setHTML(description)
    .addTo(map!)
}

function drawMarkers (markers: MarkerFeature[]) {
  for (const m of markerLayer.value) {
    m.remove()
  }
  const newMarkers: maplibre.Marker[] = []
  for (const m of markers) {
    const markerOptions: maplibre.MarkerOptions = {
      draggable: m.draggable,
      color: m.color,
    }

    // Use custom element if provided
    if (m.element) {
      markerOptions.element = m.element
    }

    const newMarker = new maplibre.Marker(markerOptions)
      .setLngLat([m.point.lon, m.point.lat])
      .addTo(map!)
    if (m.onDragEnd) {
      newMarker.on('dragend', m.onDragEnd)
    }
    newMarkers.push(newMarker)
  }
  markerLayer.value = newMarkers
}

//////////////////////
// Map events

function mapClick (e: maplibre.MapMouseEvent) {
  const features = map?.queryRenderedFeatures(e.point, { layers: ['points', 'lines'] })
  if (features) {
    emit('mapClickFeatures', e.lngLat, features)
  }
}

function mapZoom () {
  emit('setZoom', map?.getZoom())
}

function mapMove () {
  emit('mapMove', { zoom: map?.getZoom(), bbox: map?.getBounds().toArray() })
}

function mapMouseMove (e: maplibre.MapMouseEvent) {
  const features = map?.queryRenderedFeatures(e.point, { layers: ['points', 'lines'] })
  if (features) {
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
    height: 100vh;
  }
  </style>
