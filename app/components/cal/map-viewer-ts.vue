<template>
  <div id="mapelem" ref="mapelem" :class="mapClass" />
</template>

<script setup lang="ts">
import { nextTick, ref, watch, onMounted, onBeforeUnmount, createApp, h } from 'vue'
import maplibre from 'maplibre-gl'
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'
import { useRuntimeConfig } from '#imports'
import type { CensusFormat, Feature, PopupFeature, Point, MarkerFeature } from '~~/src/core'
import { STOP_AGG_ELEMENT_IDS, STOP_CLUSTER_COLOR, densityUnitLabel, formatCensusValue } from '~~/src/core'
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
  'overlayDragStart',
  'overlayDrag',
  'overlayDragEnd',
  'selectableGeoClick',
  'selectableGeoRightClick',
  'openTimetable',
])

const overlayFeatures = defineModel<Feature[]>('overlayFeatures', { default: [] })
const choroplethFeatures = defineModel<Feature[]>('choroplethFeatures', { default: [] })
const selectableGeographies = defineModel<Feature[]>('selectableGeographies', { default: [] })
const features = defineModel<Feature[]>('features', { default: [] })
const flexFeatures = defineModel<Feature[]>('flexFeatures', { default: [] })
// stop cluster markers + the selected cluster's radius circle.
const clusterFeatures = defineModel<Feature[]>('clusterFeatures', { default: [] })
const clusterCircleFeatures = defineModel<Feature[]>('clusterCircleFeatures', { default: [] })
// connector lines from the selected cluster's anchor stop to its member stops.
const clusterLineFeatures = defineModel<Feature[]>('clusterLineFeatures', { default: [] })
// multi-colored "beach ball" markers, one per cluster, drawn at its anchor stop.
const clusterMarkers = defineModel<{ id: string, point: Point, colors: string[] }[]>('clusterMarkers', { default: [] })
const markers = defineModel<MarkerFeature[]>('markers', { default: [] })
const popupFeatures = defineModel<PopupFeature[]>('popupFeatures', { default: [] })
const mapClass = defineModel<string>('mapClass', { default: 'short' })
const center = defineModel<Point>('center', { default: { lon: -122.4194, lat: 37.7749 } })
const zoom = defineModel<number>('zoom', { default: 12 })

const props = defineProps<{
  // Current loading stage - skip map updates during 'schedules' stage to prevent browser crashes
  loadingStage?: string
  // Left padding in pixels to account for overlay panels covering the map
  panelWidth?: number
  // Bounds to fit the map to on load and when fitBoundsKey changes
  initialBounds?: { sw: { lon: number, lat: number }, ne: { lon: number, lat: number } }
  // Increment to trigger a fitBounds to initialBounds (avoids refitting on map-originated bbox changes)
  fitBoundsKey?: number
  // Increment to trigger a fitBounds to fitTargetFeatures
  fitOverlayKey?: number
  // Features to fit to when fitOverlayKey changes
  fitTargetFeatures?: Feature[]
}>()

const { unitSystem, isAllDayMode } = useScenarioDisplay()

// Stages during which we should skip expensive map updates
const skipUpdateStages = new Set(['schedules'])

let map: (maplibre.Map | undefined) = undefined
const markerLayer = ref<maplibre.Marker[]>([])
const clusterMarkerLayer = ref<maplibre.Marker[]>([])
let geoHoverPopup: maplibre.Popup | undefined

// Choropleth hover tooltip — created in initMap, cleaned up in onBeforeUnmount
let choroplethTooltip: HTMLDivElement | undefined

//////////////////////
// Watchers

watch(() => overlayFeatures.value, (v) => {
  nextTick(() => {
    updateOverlayFeatures(v)
  })
})

watch(() => choroplethFeatures.value, (v) => {
  nextTick(() => {
    updateChoroplethFeatures(v)
  })
})

watch(() => selectableGeographies.value, (v) => {
  nextTick(() => {
    updateSelectableGeographies(v)
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

watch(() => clusterFeatures.value, (v) => {
  updateClusterFeatures(v)
})

watch(() => clusterCircleFeatures.value, (v) => {
  updateClusterCircle(v)
})

watch(() => clusterLineFeatures.value, (v) => {
  updateClusterLines(v)
})

watch(() => clusterMarkers.value, (v) => {
  drawClusterMarkers(v)
})

// When exiting a skip stage (e.g., schedules -> complete), render all features
watch(() => props.loadingStage, (newStage, oldStage) => {
  if (oldStage && skipUpdateStages.has(oldStage) && (!newStage || !skipUpdateStages.has(newStage))) {
    // Exited a skip stage - render the features
    updateFeatures(features.value)
    updateFlexFeatures(flexFeatures.value)
    updateClusterFeatures(clusterFeatures.value)
    updateClusterCircle(clusterCircleFeatures.value)
    updateClusterLines(clusterLineFeatures.value)
    drawClusterMarkers(clusterMarkers.value)
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

function applyPanelPadding (left: number) {
  map?.setPadding({ left, top: 0, right: 0, bottom: 0 })
}

watch(() => props.panelWidth, (v) => {
  applyPanelPadding(v || 0)
})

watch(() => props.fitOverlayKey, () => {
  if (map && props.fitTargetFeatures?.length) {
    fitFeatures(props.fitTargetFeatures)
  }
})

watch(() => props.fitBoundsKey, () => {
  if (props.initialBounds && map) {
    const { sw, ne } = props.initialBounds
    map.fitBounds([[sw.lon, sw.lat], [ne.lon, ne.lat]], { duration: 0, padding: 100 })
  }
})

//////////////////////
// Map initialization
onMounted(() => {
  initMap()
})

onBeforeUnmount(() => {
  if (geoHoverPopup) {
    geoHoverPopup.remove()
    geoHoverPopup = undefined
  }
  choroplethTooltip?.remove()
  choroplethTooltip = undefined
  if (currentPopupApp) {
    currentPopupApp.unmount()
    currentPopupApp = undefined
  }
  map?.remove()
  map = undefined
})

// Protomaps basemap label layers (street/place labels), rendered above transit overlays.
// The vendored font directories use hyphenated, space-free names (see
// scripts/vendor-basemaps-assets.sh) so they serve reliably from static hosts —
// spaces in the path can fall through to the SPA fallback — so rewrite the
// text-font names to match the directories the glyphs URL requests.
function protomapsLabelLayers () {
  const labelLayers = protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en', labelsOnly: true })
  return JSON.parse(
    JSON.stringify(labelLayers)
      .replaceAll('Noto Sans Regular', 'Noto-Sans-Regular')
      .replaceAll('Noto Sans Medium', 'Noto-Sans-Medium')
      .replaceAll('Noto Sans Italic', 'Noto-Sans-Italic'),
  ) as typeof labelLayers
}

// Protomaps basemap base layers (everything except labels). @protomaps/basemaps has no
// direct "no labels" generator, so derive it as the full set minus the labels-only set.
function protomapsBaseLayers () {
  const labelIds = new Set(protomapsLabelLayers().map(l => l.id))
  return protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en' })
    .filter(l => !labelIds.has(l.id))
}

function initMap () {
  if (map) {
    return
  }
  // MapLibre requires an absolute sprite URL, so anchor the self-hosted assets
  // to the app's own origin (also used for glyphs, for consistency).
  const assetOrigin = window.location.origin
  const opts: maplibre.MapOptions = {
    interactive: true,
    container: 'mapelem',
    zoom: zoom.value,
    center: center.value,
    style: {
      glyphs: `${assetOrigin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${assetOrigin}/basemaps-assets/sprites/v4/white`,
      version: 8,
      sources: {
        'protomaps-base': {
          type: 'vector',
          tiles: [`https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${config.public.tlv2.protomapsApikey}`],
          maxzoom: 15,
          attribution: '<a href="https://www.transit.land/terms">Transitland</a> | <a href="https://protomaps.com">Protomaps</a> | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }
      },
      layers: protomapsBaseLayers()
    }
  }
  map = new maplibre.Map(opts)
  map.addControl(new maplibre.FullscreenControl())
  map.addControl(new maplibre.NavigationControl())

  // Create choropleth tooltip element (must be in mounted context, not module scope)
  choroplethTooltip = document.createElement('div')
  choroplethTooltip.className = 'choropleth-tooltip'
  choroplethTooltip.style.display = 'none'
  map.getContainer().appendChild(choroplethTooltip)
  drawMarkers(markers.value)
  map.on('load', () => {
    if (props.panelWidth) {
      applyPanelPadding(props.panelWidth)
    }
    if (props.initialBounds) {
      const { sw, ne } = props.initialBounds
      map?.fitBounds([[sw.lon, sw.lat], [ne.lon, ne.lat]], { duration: 0, padding: 100 })
    }
    createSources()
    createLayers()
    updateOverlayFeatures(overlayFeatures.value)
    updateChoroplethFeatures(choroplethFeatures.value)
    updateSelectableGeographies(selectableGeographies.value)
    updateFeatures(features.value)
    updateFlexFeatures(flexFeatures.value)
    updateClusterFeatures(clusterFeatures.value)
    updateClusterCircle(clusterCircleFeatures.value)
    updateClusterLines(clusterLineFeatures.value)
    drawClusterMarkers(clusterMarkers.value)
    map?.on('mousemove', mapMouseMove)
    map?.on('click', mapClick)
    map?.on('zoom', mapZoom)
    map?.on('moveend', mapMove)
    map?.resize()

    // Overlay polygon dragging — allows moving the bbox by dragging its interior
    let overlayDragActive = false
    map?.on('mousedown', 'overlay-polygons', (e: maplibre.MapLayerMouseEvent) => {
      if (markers.value.length === 0 || e.originalEvent.button !== 0) { return }
      e.preventDefault()
      overlayDragActive = true
      map!.dragPan.disable()
      map!.getCanvas().style.cursor = 'move'
      emit('overlayDragStart', { lon: e.lngLat.lng, lat: e.lngLat.lat })

      const onMove = (moveEvent: maplibre.MapMouseEvent) => {
        emit('overlayDrag', { lon: moveEvent.lngLat.lng, lat: moveEvent.lngLat.lat })
      }
      const onUp = () => {
        map!.off('mousemove', onMove)
        map!.dragPan.enable()
        map!.getCanvas().style.cursor = ''
        overlayDragActive = false
        emit('overlayDragEnd')
      }
      map!.on('mousemove', onMove)
      map!.once('mouseup', onUp)
    })
    map?.on('mouseenter', 'overlay-polygons', () => {
      if (markers.value.length > 0 && !overlayDragActive) {
        map!.getCanvas().style.cursor = 'move'
      }
    })
    map?.on('mouseleave', 'overlay-polygons', () => {
      if (!overlayDragActive) {
        map!.getCanvas().style.cursor = ''
      }
    })

    // Choropleth hover tooltip
    let choroplethHoveredId: string | null = null

    map?.on('mousemove', 'choropleth-fill', (e: maplibre.MapLayerMouseEvent) => {
      if (!e.features || e.features.length === 0) { return }
      const feature = e.features[0]!
      const fp = feature.properties

      // Highlight: thicken border of hovered polygon
      // Uses geoid as the promoted ID for feature-state
      const featureId = fp?.geoid?.toString() || feature.id?.toString() || ''
      if (featureId && featureId !== choroplethHoveredId) {
        // Reset previous highlight
        if (choroplethHoveredId !== null) {
          map!.setFeatureState({ source: 'choropleth', id: choroplethHoveredId }, { hover: false })
        }
        choroplethHoveredId = featureId
        map!.setFeatureState({ source: 'choropleth', id: featureId }, { hover: true })
      }

      // Show tooltip using safe DOM construction (no innerHTML)
      if (!choroplethTooltip) { return }
      choroplethTooltip.textContent = ''
      const title = document.createElement('strong')
      title.textContent = String(fp?.name || fp?.geoid || '')
      choroplethTooltip.appendChild(title)
      const visitsLabel = isAllDayMode.value ? 'Total visits' : 'Total visits in window'
      for (const [label, value] of [
        ['Stops', fp?.stops_count ?? 0],
        ['Routes', fp?.routes_count ?? 0],
        ['Agencies', fp?.agencies_count ?? 0],
        [visitsLabel, fp?.visit_count_total ?? 0],
      ]) {
        choroplethTooltip.appendChild(document.createElement('br'))
        const line = document.createTextNode(`${label}: ${value}`)
        choroplethTooltip.appendChild(line)
      }
      // Currently-shaded element: total / scaled / density. Skip stop-derived
      // elements (visit_count_total, stops_count) since their values already
      // appear in the four counts above.
      const shadedElement = fp?.shaded_element as string | undefined
      const shadedLabel = fp?.shaded_label as string | undefined
      if (shadedLabel && shadedElement && !STOP_AGG_ELEMENT_IDS.has(shadedElement)) {
        const fmt = (fp?.shaded_format as CensusFormat | undefined) ?? 'integer'
        const full = fp?.shaded_full_value ?? null
        const scaled = fp?.shaded_scaled_value ?? null
        const density = fp?.shaded_density_value ?? null
        choroplethTooltip.appendChild(document.createElement('br'))
        const heading = document.createElement('strong')
        heading.textContent = shadedLabel
        choroplethTooltip.appendChild(heading)
        const lines: Array<[string, string]> = [['Total', formatCensusValue(full as number | null, fmt)]]
        if (scaled !== null) {
          lines.push(['Intersection', formatCensusValue(scaled as number | null, fmt)])
        }
        if (density !== null) {
          lines.push(['Density', `${formatCensusValue(density as number | null, fmt)} ${densityUnitLabel(unitSystem.value)}`])
        }
        for (const [k, v] of lines) {
          choroplethTooltip.appendChild(document.createElement('br'))
          choroplethTooltip.appendChild(document.createTextNode(`  ${k}: ${v}`))
        }
      }
      choroplethTooltip.style.display = 'block'
      choroplethTooltip.style.left = `${e.originalEvent.offsetX + 15}px`
      choroplethTooltip.style.top = `${e.originalEvent.offsetY + 15}px`
    })

    map?.on('mouseleave', 'choropleth-fill', () => {
      if (choroplethTooltip) { choroplethTooltip.style.display = 'none' }
      if (choroplethHoveredId !== null) {
        map!.setFeatureState({ source: 'choropleth', id: choroplethHoveredId }, { hover: false })
        choroplethHoveredId = null
      }
    })

    // Selectable geography interactions
    // Left-click to add to selection
    map?.on('click', 'selectable-geo-fill', (e: maplibre.MapLayerMouseEvent) => {
      const feature = e.features?.[0]
      if (feature) {
        const geoId = feature.properties?.['geography-id']
        if (geoId != null) {
          emit('selectableGeoClick', geoId.toString())
        }
      }
    })
    // Right-click to remove from selection
    map?.on('contextmenu', 'selectable-geo-fill', (e: maplibre.MapLayerMouseEvent) => {
      e.preventDefault()
      const feature = e.features?.[0]
      if (feature) {
        const geoId = feature.properties?.['geography-id']
        if (geoId != null) {
          emit('selectableGeoRightClick', geoId.toString())
        }
      }
    })
    // Hover: show feature name tooltip and pointer cursor (pointer only for clickable)
    // geoHoverPopup is declared at module scope so onBeforeUnmount can clean it up
    map?.on('mousemove', 'selectable-geo-fill', (e: maplibre.MapLayerMouseEvent) => {
      const isClickable = e.features?.[0]?.properties?.clickable
      map!.getCanvas().style.cursor = isClickable ? 'pointer' : 'default'
      const feature = e.features?.[0]
      const name = feature?.properties?.['geography-name']
      if (name) {
        if (!geoHoverPopup) {
          geoHoverPopup = new maplibre.Popup({
            closeButton: false,
            closeOnClick: false,
            className: 'geo-hover-popup',
            offset: 10,
          })
          geoHoverPopup.addTo(map!)
        }
        geoHoverPopup.setLngLat(e.lngLat).setText(name)
      }
    })
    map?.on('mouseleave', 'selectable-geo-fill', () => {
      map!.getCanvas().style.cursor = ''
      if (geoHoverPopup) {
        geoHoverPopup.remove()
        geoHoverPopup = undefined
      }
    })
  })
}

function createSources () {
  map?.addSource('overlayPolygons', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('choropleth', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    promoteId: 'geoid',
  })
  map?.addSource('selectableGeographies', {
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
  // stop cluster markers and the selected cluster's radius circle.
  map?.addSource('clusters', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('clusterCircle', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
  map?.addSource('clusterLines', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  })
}

function createLayers () {
  for (const labelLayer of protomapsLabelLayers()) {
    map?.addLayer(labelLayer)
  }

  // Choropleth aggregation overlay (below all feature layers)
  map?.addLayer({
    id: 'choropleth-fill',
    type: 'fill',
    source: 'choropleth',
    paint: {
      'fill-color': ['coalesce', ['get', 'fill'], '#eff3ff'],
      'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.45],
    }
  })
  map?.addLayer({
    id: 'choropleth-outline',
    type: 'line',
    source: 'choropleth',
    paint: {
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        '#000',
        ['coalesce', ['get', 'stroke'], '#333']
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        3,
        ['coalesce', ['get', 'stroke-width'], 1.5]
      ],
      'line-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        1.0,
        ['coalesce', ['get', 'stroke-opacity'], 0.7]
      ],
    }
  })

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

  // Selectable geography layers (for click-to-select in adminBoundary mode)
  map?.addLayer({
    id: 'selectable-geo-fill',
    type: 'fill',
    source: 'selectableGeographies',
    layout: {},
    paint: {
      'fill-color': ['coalesce', ['get', 'fill'], '#888888'],
      'fill-opacity': ['coalesce', ['get', 'fill-opacity'], 0.05],
    }
  })
  // Solid outline for clickable (current layer) geographies
  map?.addLayer({
    id: 'selectable-geo-outline',
    type: 'line',
    source: 'selectableGeographies',
    filter: ['==', ['get', 'clickable'], true],
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#888888'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 1],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 0.5],
    }
  })
  // Dashed outline for non-clickable (other layer) geographies
  map?.addLayer({
    id: 'selectable-geo-outline-dashed',
    type: 'line',
    source: 'selectableGeographies',
    filter: ['==', ['get', 'clickable'], false],
    layout: {},
    paint: {
      'line-color': ['coalesce', ['get', 'stroke'], '#999999'],
      'line-width': ['coalesce', ['get', 'stroke-width'], 1.5],
      'line-opacity': ['coalesce', ['get', 'stroke-opacity'], 0.5],
      'line-dasharray': [4, 4],
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
      // Zoom-dependent circle radius: smaller at low zooms, larger at high zooms
      // Uses the marker-radius property as the base size at zoom 14
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, ['*', ['coalesce', ['get', 'marker-radius'], 10], 0.3], // At zoom 8: 30% of base size
        10, ['*', ['coalesce', ['get', 'marker-radius'], 10], 0.5], // At zoom 10: 50% of base size
        12, ['*', ['coalesce', ['get', 'marker-radius'], 10], 0.75], // At zoom 12: 75% of base size
        14, ['coalesce', ['get', 'marker-radius'], 10], // At zoom 14: full base size
        16, ['*', ['coalesce', ['get', 'marker-radius'], 10], 1.25] // At zoom 16+: 125% of base size
      ],
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

  // selected cluster radius circle. circle-radius interpolates the per-feature
  // pixels-at-zoom-0 value by exponential(2) so it tracks a true metric radius.
  // Below 'points' so stop dots stay on top and clickable.
  map?.addLayer({
    id: 'cluster-circle',
    type: 'circle',
    source: 'clusterCircle',
    paint: {
      'circle-radius': [
        'interpolate', ['exponential', 2], ['zoom'],
        0, ['get', 'radius_px_z0'],
        24, ['*', ['get', 'radius_px_z0'], 16777216],
      ],
      'circle-color': STOP_CLUSTER_COLOR,
      'circle-opacity': 0.12,
      'circle-stroke-color': STOP_CLUSTER_COLOR,
      'circle-stroke-width': 2,
      'circle-stroke-opacity': 0.9,
    }
  }, 'points')

  // connector lines from the anchor stop to each member. Below 'points' so dots stay clickable.
  map?.addLayer({
    id: 'cluster-lines',
    type: 'line',
    source: 'clusterLines',
    layout: {
      'line-cap': 'round',
    },
    paint: {
      'line-color': STOP_CLUSTER_COLOR,
      'line-width': 2,
      'line-opacity': 0.9,
    }
  }, 'points')

  // Invisible click target per cluster: the visible "beach ball" is a
  // pointer-events:none DOM marker, so clicks fall through to this circle.
  map?.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'clusters',
    paint: {
      'circle-radius': 18,
      'circle-opacity': 0,
    }
  })
}

const isPoint = (f: Feature) => f.geometry?.type === 'Point'
const isLine = (f: Feature) => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString'
const isPolygon = (f: Feature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'

// Push features into a GeoJSON source, optionally filtering by geometry type.
// No-ops if the map or the source isn't ready yet (sources are added together
// in initMap, so a missing source means none are ready).
function setSourceData (sourceId: string, features: Feature[], filter?: (f: Feature) => boolean) {
  if (!map) { return }
  const source = map.getSource(sourceId) as maplibre.GeoJSONSource
  if (!source) { return }
  const data = filter ? features.filter(filter) : features
  source.setData({ type: 'FeatureCollection', features: data as any })
}

function updateChoroplethFeatures (features: Feature[]) {
  setSourceData('choropleth', features, isPolygon)
}

function updateOverlayFeatures (features: Feature[]) {
  setSourceData('overlayPolygons', features, isPolygon)
}

function updateSelectableGeographies (features: Feature[]) {
  setSourceData('selectableGeographies', features, isPolygon)
}

function updateFeatures (features: Feature[]) {
  setSourceData('points', features, isPoint)
  setSourceData('lines', features, isLine)
  setSourceData('polygons', features, isPolygon)
}

function updateFlexFeatures (features: Feature[]) {
  setSourceData('flexPolygons', features, isPolygon)
}

// update the cluster marker + radius-circle sources.
function updateClusterFeatures (features: Feature[]) {
  setSourceData('clusters', features)
}

function updateClusterCircle (features: Feature[]) {
  setSourceData('clusterCircle', features)
}

function updateClusterLines (features: Feature[]) {
  setSourceData('clusterLines', features)
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
let currentPopup: maplibre.Popup | undefined = undefined
let currentPopupApp: ReturnType<typeof createApp> | undefined = undefined
let currentPopupFeatures: PopupFeature[] = []
let currentPopupIndex = 0

/**
 * Update the highlight layer to show the selected feature
 */
function updateHighlight (popupFeature: PopupFeature | undefined) {
  if (!map) { return }

  const highlightSource = map.getSource('highlight') as maplibre.GeoJSONSource
  if (!highlightSource) { return }

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
    currentPopup = undefined
  }
  if (currentPopupApp) {
    currentPopupApp.unmount()
    currentPopupApp = undefined
  }

  if (features.length === 0) {
    currentPopupFeatures = []
    currentPopupIndex = 0
    // Clear highlight when closing popup
    updateHighlight(undefined)
    return
  }

  currentPopupFeatures = features
  currentPopupIndex = 0
  showPopupAtIndex(0)
}

function showPopupAtIndex (index: number) {
  if (currentPopupFeatures.length === 0) { return }

  // Close existing popup and unmount Vue app
  if (currentPopup) {
    currentPopup.remove()
  }
  if (currentPopupApp) {
    currentPopupApp.unmount()
    currentPopupApp = undefined
  }

  currentPopupIndex = index
  const feature = currentPopupFeatures[index]
  if (!feature) { return }

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
          currentPopup = undefined
        }
        if (currentPopupApp) {
          currentPopupApp.unmount()
          currentPopupApp = undefined
        }
        updateHighlight(undefined)
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
      onOpenTimetable: (featureId: string | number) => {
        emit('openTimetable', featureId)
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
      currentPopupApp = undefined
    }
  })

  // Add to map
  popup.addTo(map!)
  currentPopup = popup
}

// Equal-wedge conic gradient for the cluster "beach ball" (one wedge/agency).
function clusterConicGradient (cols: string[]): string {
  if (cols.length === 0) {
    return STOP_CLUSTER_COLOR
  }
  if (cols.length === 1) {
    return cols[0] as string
  }
  const step = 360 / cols.length
  const stops = cols.map((c, i) => `${c} ${i * step}deg ${(i + 1) * step}deg`).join(', ')
  return `conic-gradient(${stops})`
}

// Cluster "beach ball" markers as DOM overlays at each anchor stop. pointer-events:
// none so clicks fall through to the invisible 'clusters' hit circle.
function drawClusterMarkers (specs: { id: string, point: Point, colors: string[] }[]) {
  if (!map) {
    return
  }
  for (const m of clusterMarkerLayer.value) {
    m.remove()
  }
  const created: maplibre.Marker[] = []
  for (const spec of specs) {
    const el = document.createElement('div')
    el.style.width = '32px'
    el.style.height = '32px'
    el.style.borderRadius = '50%'
    el.style.border = '2px solid #fff'
    el.style.boxShadow = '0 0 2px rgba(0, 0, 0, 0.5)'
    el.style.background = clusterConicGradient(spec.colors)
    el.style.pointerEvents = 'none'
    const marker = new maplibre.Marker({ element: el })
      .setLngLat([spec.point.lon, spec.point.lat])
      .addTo(map)
    created.push(marker)
  }
  clusterMarkerLayer.value = created
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

    if (m.onDrag) {
      newMarker.on('drag', m.onDrag)
    }
    if (m.onDragEnd) {
      newMarker.on('dragend', m.onDragEnd)
    }
    if (m.onCreated) {
      m.onCreated(newMarker)
    }
    newMarkers.push(newMarker)
  }
  markerLayer.value = newMarkers
}

//////////////////////
// Map events

function mapClick (e: maplibre.MapMouseEvent) {
  // 'clusters' first so a cluster marker click is recognized even when it sits
  // over a stop dot.
  const layersToQuery = ['clusters', 'points', 'lines', 'flex-polygons', 'flex-polygons-outline-solid', 'flex-polygons-outline-dashed', 'choropleth-fill']
    .filter(layerId => map?.getLayer(layerId)) // Only query layers that exist

  if (layersToQuery.length === 0) { return }

  const features = map?.queryRenderedFeatures(e.point, { layers: layersToQuery })
  if (features) {
    emit('mapClickFeatures', e.lngLat, features)
  }
}

function mapZoom () {
  emit('setZoom', map?.getZoom())
}

function mapMove () {
  if (!map) { return }
  // Emit only the visible bounds (excluding area under the panel overlay)
  const canvas = map.getCanvas()
  const left = props.panelWidth || 0
  const sw = map.unproject([left, canvas.clientHeight])
  const ne = map.unproject([canvas.clientWidth, 0])
  emit('mapMove', { zoom: map.getZoom(), bbox: [[sw.lng, sw.lat], [ne.lng, ne.lat]] })
}

function mapMouseMove (e: maplibre.MapMouseEvent) {
  // Query all existing layers for hover detection
  const layersToQuery = ['points', 'lines', 'flex-polygons', 'flex-polygons-outline-solid', 'flex-polygons-outline-dashed']
    .filter(layerId => map?.getLayer(layerId)) // Only query layers that exist

  if (layersToQuery.length === 0) { return }

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

  .choropleth-tooltip {
    position: absolute;
    z-index: 20;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.4;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    max-width: 250px;
  }

  /* Hover tooltip for selectable geographies */
  .geo-hover-popup .maplibregl-popup-content {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  }
  .geo-hover-popup .maplibregl-popup-tip {
    display: none;
  }
  </style>
