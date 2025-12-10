<template>
  <div id="mapelem" ref="mapelem" :class="mapClass" />
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onMounted, createApp, h } from 'vue'
import maplibre from 'maplibre-gl'
import { noLabels, labels } from 'protomaps-themes-base'
import { useRuntimeConfig } from '#imports'
import type { Feature, PopupFeature, Point, MarkerFeature } from '~~/src/core'
import CalMapPopup from './map-popup.vue'

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
const flexFeatures = defineModel<Feature[]>('flexFeatures', { default: [] })
const markers = defineModel<MarkerFeature[]>('markers', { default: [] })
const popupFeatures = defineModel<PopupFeature[]>('popupFeatures', { default: [] })
const mapClass = defineModel<string>('mapClass', { default: 'short' })
const center = defineModel<Point>('center', { default: { lon: -122.4194, lat: 37.7749 } })
const zoom = defineModel<number>('zoom', { default: 12 })

// Props for loading state
const props = defineProps<{
  // Current loading stage - skip map updates during 'schedules' stage to prevent browser crashes
  loadingStage?: string
}>()

// Stages during which we should skip expensive map updates
const skipUpdateStages = new Set(['schedules'])

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

// Skip feature updates during heavy loading stages (schedules) to prevent browser crashes
// Allow updates during geometry stages (feed-versions, stops, routes, flex-areas)
watch(() => features.value, (v) => {
  if (!props.loadingStage || !skipUpdateStages.has(props.loadingStage)) {
    updateFeatures(v)
  }
})

watch(() => flexFeatures.value, (v) => {
  if (!props.loadingStage || !skipUpdateStages.has(props.loadingStage)) {
    updateFlexFeatures(v)
  }
})

// When exiting a skip stage (e.g., schedules -> complete), render all features
watch(() => props.loadingStage, (newStage, oldStage) => {
  if (oldStage && skipUpdateStages.has(oldStage) && (!newStage || !skipUpdateStages.has(newStage))) {
    // Exited a skip stage - render the features
    updateFeatures(features.value)
    updateFlexFeatures(flexFeatures.value)
  }
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
          tiles: [`https://api.protomaps.com/tiles/v2/{z}/{x}/{y}.pbf?key=${config.public.tlv2.protomapsApikey}`],
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
    updateFlexFeatures(flexFeatures.value)
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
  map?.addSource('flexPolygons', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  // Highlight source for selected features
  map?.addSource('highlight', {
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

  // Flex Services (DRT) polygon layers
  map?.addLayer({
    id: 'flex-polygons',
    type: 'fill',
    source: 'flexPolygons',
    layout: {},
    paint: {
      // Color from feature properties, fallback to gray
      'fill-color': ['coalesce', ['get', 'fill'], '#888888'],
      // Lower opacity for overlapping areas - can see through to fixed routes
      'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.25],
    }
  })
  // Solid outline layer for marked features
  map?.addLayer({
    id: 'flex-polygons-outline-solid',
    type: 'line',
    source: 'flexPolygons',
    filter: ['==', ['get', 'marked'], true],
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#888888'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 1.5],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 0.8],
    }
  })
  // Dashed outline layer for unmarked features
  map?.addLayer({
    id: 'flex-polygons-outline-dashed',
    type: 'line',
    source: 'flexPolygons',
    filter: ['==', ['get', 'marked'], false],
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#888888'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 1.5],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 0.8],
      'line-dasharray': [4, 4],
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
      'circle-color': ['coalesce', ['get', 'marker-color'], '#888888'], // gray is the fallback color for stop points while routes or other data that may be needed for styling logic is still loading
      'circle-radius': ['coalesce', ['get', 'marker-radius'], 10],
      'circle-opacity': ['coalesce', ['get', 'marker-opacity'], 1.0],
    }
  })

  // Highlight layers for selected features (rendered on top)
  map?.addLayer({
    id: 'highlight-polygon',
    type: 'fill',
    source: 'highlight',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': '#00FF00',
      'fill-opacity': 0.2,
    }
  })
  map?.addLayer({
    id: 'highlight-polygon-outline',
    type: 'line',
    source: 'highlight',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'line-color': '#00FF00',
      'line-width': 4,
      'line-opacity': 1.0,
    }
  })
  map?.addLayer({
    id: 'highlight-line',
    type: 'line',
    source: 'highlight',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {
      'line-color': '#00FF00',
      'line-width': 6,
      'line-opacity': 1.0,
    }
  })
  map?.addLayer({
    id: 'highlight-point',
    type: 'circle',
    source: 'highlight',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-color': '#00FF00',
      'circle-radius': 14,
      'circle-opacity': 1.0,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 3,
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
    polygonSource.setData({ type: 'FeatureCollection', features: polygons as any })
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
    lineSource.setData({ type: 'FeatureCollection', features: lines as any })
  }
  if (pointSource) {
    pointSource.setData({ type: 'FeatureCollection', features: points as any })
  }
  if (polygonSource) {
    polygonSource.setData({ type: 'FeatureCollection', features: polygons as any })
  }
}

/**
 * Update flex service area polygons on the map
 */
function updateFlexFeatures (features: Feature[]) {
  if (!map) {
    return
  }
  const flexSource = map.getSource('flexPolygons') as maplibre.GeoJSONSource
  if (!flexSource) {
    return
  }
  // Filter to only polygon/multipolygon geometries (flex areas are polygons)
  const polygons = features.filter((s) => {
    return s.geometry?.type === 'Polygon' || s.geometry?.type === 'MultiPolygon'
  })
  flexSource.setData({ type: 'FeatureCollection', features: polygons as any })
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

// Track the current popup and its state for multi-feature navigation
let currentPopup: maplibre.Popup | null = null
let currentPopupApp: ReturnType<typeof createApp> | null = null
let currentPopupFeatures: PopupFeature[] = []
let currentPopupIndex = 0

/**
 * Update the highlight layer to show the selected feature
 */
function updateHighlight (popupFeature: PopupFeature | null) {
  if (!map) return

  const highlightSource = map.getSource('highlight') as maplibre.GeoJSONSource
  if (!highlightSource) return

  if (!popupFeature || !popupFeature.featureId || !popupFeature.sourceLayer) {
    // Clear highlight
    highlightSource.setData({ type: 'FeatureCollection', features: [] })
    return
  }

  // Find the feature in the appropriate source
  const sourceLayer = popupFeature.sourceLayer
  const featureId = popupFeature.featureId

  // Look up the feature from our stored feature arrays based on source layer
  let matchingFeature: Feature | undefined

  if (sourceLayer === 'flexPolygons') {
    // For flex features, match by location_id in properties (since that's what we use as featureId)
    matchingFeature = flexFeatures.value.find(f =>
      f.properties?.location_id?.toString() === featureId.toString()
      || f.id?.toString() === featureId.toString()
    )
  } else if (sourceLayer === 'lines') {
    matchingFeature = features.value.find(f => f.id?.toString() === featureId.toString() && (f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'))
  } else if (sourceLayer === 'points') {
    matchingFeature = features.value.find(f => f.id?.toString() === featureId.toString() && f.geometry?.type === 'Point')
  }

  if (matchingFeature) {
    highlightSource.setData({
      type: 'FeatureCollection',
      features: [matchingFeature as any]
    })
  } else {
    // Fallback: try querySourceFeatures for rendered tiles
    const renderedFeatures = map.querySourceFeatures(sourceLayer, {})
    const renderedMatch = renderedFeatures.find(f =>
      f.properties?.location_id?.toString() === featureId.toString()
      || f.id?.toString() === featureId.toString()
    )
    if (renderedMatch) {
      highlightSource.setData({
        type: 'FeatureCollection',
        features: [renderedMatch as any]
      })
    } else {
      highlightSource.setData({ type: 'FeatureCollection', features: [] })
    }
  }
}

function drawPopupFeatures (features: PopupFeature[]) {
  // Close existing popup and unmount Vue app
  if (currentPopup) {
    currentPopup.remove()
    currentPopup = null
  }
  if (currentPopupApp) {
    currentPopupApp.unmount()
    currentPopupApp = null
  }

  if (features.length === 0) {
    currentPopupFeatures = []
    currentPopupIndex = 0
    // Clear highlight when closing popup
    updateHighlight(null)
    return
  }

  currentPopupFeatures = features
  currentPopupIndex = 0
  showPopupAtIndex(0)
}

function showPopupAtIndex (index: number) {
  if (currentPopupFeatures.length === 0) return

  // Close existing popup and unmount Vue app
  if (currentPopup) {
    currentPopup.remove()
  }
  if (currentPopupApp) {
    currentPopupApp.unmount()
    currentPopupApp = null
  }

  currentPopupIndex = index
  const feature = currentPopupFeatures[index]
  if (!feature) return

  // Ensure feature has required data for Vue component
  if (!feature.featureType || !feature.data) {
    console.warn('[Popup] Feature missing featureType or data, skipping:', feature)
    return
  }

  // Update highlight to show the selected feature
  updateHighlight(feature)

  const total = currentPopupFeatures.length

  // Create a container for the Vue component
  const container = document.createElement('div')
  container.className = 'popup-vue-container'

  // Create and mount the Vue popup component
  const app = createApp({
    render: () => h(CalMapPopup, {
      feature: {
        featureType: feature.featureType!,
        featureId: feature.featureId || '',
        sourceLayer: feature.sourceLayer || '',
        data: feature.data!,
      },
      currentIndex: currentPopupIndex,
      total: total,
      onClose: () => {
        if (currentPopup) {
          currentPopup.remove()
          currentPopup = null
        }
        if (currentPopupApp) {
          currentPopupApp.unmount()
          currentPopupApp = null
        }
        updateHighlight(null)
      },
      onPrev: () => {
        if (currentPopupIndex > 0) {
          showPopupAtIndex(currentPopupIndex - 1)
        }
      },
      onNext: () => {
        if (currentPopupIndex < currentPopupFeatures.length - 1) {
          showPopupAtIndex(currentPopupIndex + 1)
        }
      },
    })
  })
  app.mount(container)
  currentPopupApp = app

  // Create MapLibre popup with DOM content
  const popup = new maplibre.Popup({
    closeButton: false, // We use our own close button
    closeOnClick: false, // Let our button handle it
    maxWidth: '380px',
    className: 'bulma-popup',
  })
    .setLngLat([feature.point.lon, feature.point.lat])
    .setDOMContent(container)

  // Clean up Vue app when popup closes
  popup.once('close', () => {
    if (currentPopupApp) {
      currentPopupApp.unmount()
      currentPopupApp = null
    }
  })

  // Add to map
  popup.addTo(map!)
  currentPopup = popup
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
  // Query all existing layers for click detection
  const layersToQuery = ['points', 'lines', 'flex-polygons', 'flex-polygons-outline-solid', 'flex-polygons-outline-dashed']
    .filter(layerId => map?.getLayer(layerId)) // Only query layers that exist

  if (layersToQuery.length === 0) return

  const features = map?.queryRenderedFeatures(e.point, { layers: layersToQuery })
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
  // Query all existing layers for hover detection
  const layersToQuery = ['points', 'lines', 'flex-polygons', 'flex-polygons-outline-solid', 'flex-polygons-outline-dashed']
    .filter(layerId => map?.getLayer(layerId)) // Only query layers that exist

  if (layersToQuery.length === 0) return

  const features = map?.queryRenderedFeatures(e.point, { layers: layersToQuery })
  if (features) {
    emit('mapHoverFeatures', features)
  }
}
</script>

  <style scss>
  @import 'maplibre-gl/dist/maplibre-gl';
  .short {
    height: 700px;
  }
  .tall {
    height: 100vh;
  }

  /* MapLibre popup container styles (component styles are in map-popup.vue) */
  .bulma-popup .maplibregl-popup-content {
    padding: 0;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    width: 380px;
  }

  .bulma-popup .maplibregl-popup-tip {
    border-top-color: #f5f5f5;
  }
  </style>
