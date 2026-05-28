<template>
  <div class="cal-buffer-details-map">
    <p v-if="loading" class="has-text-grey cal-buffer-details-map-msg">
      Loading geometry…
    </p>
    <p v-else-if="error" class="has-text-danger cal-buffer-details-map-msg">
      Failed to load geometry: {{ error }}
    </p>
    <p v-else-if="geographies.length === 0" class="has-text-grey cal-buffer-details-map-msg">
      No geometry to display.
    </p>
    <div
      ref="mapContainer"
      class="cal-buffer-details-map-canvas"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibre from 'maplibre-gl'
import { noLabels } from 'protomaps-themes-base'
import { useRuntimeConfig } from '#imports'
import type { BufferGeographyIntersection } from '~~/src/tl'

const props = defineProps<{
  geographies: BufferGeographyIntersection[]
  loading?: boolean
  error?: string | null
}>()

const config = useRuntimeConfig()
const mapContainer = ref<HTMLDivElement>()
const map = ref<maplibre.Map | null>(null)

// Raw ACS total-population column. Repeated literal rather than imported —
// the constant lives privately in census-columns.ts.
const POPULATION_KEY = 'b01003_001'

function buildFeatureCollections () {
  const baseFeatures: GeoJSON.Feature[] = []
  const intersectionFeatures: GeoJSON.Feature[] = []
  for (const g of props.geographies) {
    const fraction = g.geometryArea > 0 ? g.intersectionArea / g.geometryArea : 0
    const pop = g.values[POPULATION_KEY]
    const properties = {
      geoid: g.geoid,
      layer: g.layer,
      population: typeof pop === 'number' ? pop : null,
      fraction,
    }
    if (g.geometry) {
      baseFeatures.push({ type: 'Feature', geometry: g.geometry, properties })
    }
    if (g.intersectionGeometry) {
      intersectionFeatures.push({ type: 'Feature', geometry: g.intersectionGeometry, properties })
    }
  }
  return {
    base: { type: 'FeatureCollection' as const, features: baseFeatures },
    intersection: { type: 'FeatureCollection' as const, features: intersectionFeatures },
  }
}

function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] || c))
}

function buildPopupHtml (p: Record<string, unknown>): string {
  const layer = escapeHtml(String(p.layer ?? ''))
  const geoid = escapeHtml(String(p.geoid ?? ''))
  const pop = typeof p.population === 'number' ? p.population.toLocaleString('en-US') : '—'
  const pct = typeof p.fraction === 'number' ? `${(p.fraction * 100).toFixed(1)}%` : '—'
  return `<div class="cal-buffer-details-map-popup">
    <div><strong>${layer}</strong> ${geoid}</div>
    <div>Population: ${pop}</div>
    <div>Intersection: ${pct}</div>
  </div>`
}

function computeBounds (features: GeoJSON.Feature[]): maplibre.LngLatBoundsLike | null {
  let minLon = Infinity; let minLat = Infinity
  let maxLon = -Infinity; let maxLat = -Infinity
  function visit (coords: any) {
    if (typeof coords[0] === 'number') {
      const [lon, lat] = coords
      if (lon < minLon) { minLon = lon }
      if (lat < minLat) { minLat = lat }
      if (lon > maxLon) { maxLon = lon }
      if (lat > maxLat) { maxLat = lat }
    } else {
      for (const c of coords) { visit(c) }
    }
  }
  for (const f of features) {
    const g = f.geometry as { coordinates?: any }
    if (g?.coordinates) { visit(g.coordinates) }
  }
  if (!Number.isFinite(minLon)) {
    return null
  }
  return [[minLon, minLat], [maxLon, maxLat]]
}

function createSourcesAndLayers (m: maplibre.Map) {
  m.addSource('base', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addSource('intersections', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  // Transparent fill on the full geography is the click target — covers both
  // the visible intersection and the surrounding area, so a single handler
  // serves both.
  m.addLayer({
    id: 'base-fill',
    type: 'fill',
    source: 'base',
    paint: { 'fill-color': '#5b6470', 'fill-opacity': 0 },
  })
  m.addLayer({
    id: 'base-outline',
    type: 'line',
    source: 'base',
    paint: { 'line-color': '#5b6470', 'line-width': 1, 'line-opacity': 0.8 },
  })
  m.addLayer({
    id: 'intersections-fill',
    type: 'fill',
    source: 'intersections',
    paint: { 'fill-color': '#e07a5f', 'fill-opacity': 0.55 },
  })
  m.addLayer({
    id: 'intersections-outline',
    type: 'line',
    source: 'intersections',
    paint: { 'line-color': '#a14a30', 'line-width': 1 },
  })
  m.on('click', 'base-fill', (e) => {
    const f = e.features?.[0]
    if (!f) {
      return
    }
    new maplibre.Popup({ closeButton: true, closeOnClick: true })
      .setLngLat(e.lngLat)
      .setHTML(buildPopupHtml(f.properties ?? {}))
      .addTo(m)
  })
  m.on('mouseenter', 'base-fill', () => {
    m.getCanvas().style.cursor = 'pointer'
  })
  m.on('mouseleave', 'base-fill', () => {
    m.getCanvas().style.cursor = ''
  })
}

// Guarded against being called before sources exist. Following the pattern in
// www-transit-land's map-viewer: don't gate on `isStyleLoaded()` (flaky),
// gate on `getSource()` (definitive).
function updateFeatures () {
  if (!map.value) {
    return
  }
  if (!map.value.getSource('base')) {
    return
  }
  const { base, intersection } = buildFeatureCollections()
  ;(map.value.getSource('base') as maplibre.GeoJSONSource).setData(base)
  ;(map.value.getSource('intersections') as maplibre.GeoJSONSource).setData(intersection)
  const bounds = computeBounds([...base.features, ...intersection.features])
  if (bounds) {
    map.value.fitBounds(bounds, { padding: 24, duration: 0, maxZoom: 14 })
  }
}

function initMap () {
  if (map.value || !mapContainer.value) {
    return
  }
  const newMap = new maplibre.Map({
    container: mapContainer.value,
    interactive: true,
    zoom: 12,
    center: [-122.4, 45.5],
    style: {
      glyphs: 'https://cdn.protomaps.com/fonts/pbf/{fontstack}/{range}.pbf',
      version: 8,
      sources: {
        'protomaps-base': {
          type: 'vector',
          tiles: [`https://api.protomaps.com/tiles/v2/{z}/{x}/{y}.pbf?key=${config.public.tlv2.protomapsApikey}`],
          maxzoom: 14,
          attribution: '<a href="https://protomaps.com">Protomaps</a> | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      },
      layers: noLabels('protomaps-base', 'grayscale'),
    },
  })
  map.value = newMap
  newMap.addControl(new maplibre.NavigationControl(), 'top-right')
  newMap.on('load', () => {
    createSourcesAndLayers(newMap)
    updateFeatures()
    // Container may have been 0×0 during construction (parent tab toggled
    // visible right before mount); resize once styled.
    newMap.resize()
  })
}

watch(() => props.geographies, () => {
  nextTick(updateFeatures)
}, { deep: false })

onMounted(() => {
  nextTick(initMap)
})

onBeforeUnmount(() => {
  if (map.value) {
    map.value.remove()
    map.value = null
  }
})
</script>

<style scoped lang="scss">
@import 'maplibre-gl/dist/maplibre-gl';

.cal-buffer-details-map {
  position: relative;
}

.cal-buffer-details-map-canvas {
  width: 100%;
  height: 480px;
  border: 1px solid var(--bulma-border);
  border-radius: 4px;
}

.cal-buffer-details-map-msg {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  background: rgba(255, 255, 255, 0.75);
  pointer-events: none;
}

:deep(.cal-buffer-details-map-popup) {
  font-size: 0.85em;
  line-height: 1.4;

  > div + div {
    margin-top: 2px;
  }
}
</style>
