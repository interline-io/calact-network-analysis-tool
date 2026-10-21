<template>
  <div class="cal-transfer-stops-map">
    <!-- The map and the lasso drawn over it share this frame, so the lasso's
         points and the map's are measured from the same corner. -->
    <div ref="frame" class="cal-transfer-stops-map-frame">
      <div ref="mapContainer" class="cal-transfer-stops-map-canvas" />
      <!-- While the lasso is on, this layer takes the pointer from the map, so
           a drag draws the lasso rather than panning. -->
      <svg
        v-if="lassoOn"
        v-if="lassoPoints.length > 1"
        class="cal-transfer-stops-map-lasso"
        <polygon
        :points="lassoPoints.map(p => p.join(',')).join(' ')"
        @pointerdown="startLasso"
        @pointermove="moveLasso"
        @pointerup="endLasso"
        @pointercancel="cancelLasso"
      />
      </svg>
    </div>
    <div class="cal-transfer-stops-map-tools">
      <cat-button
        size="small"
        icon-left="lasso"
        :variant="lassoOn ? 'primary' : undefined"
        v-bind="{ 'aria-pressed': lassoOn }"
        @click="lassoOn = !lassoOn"
      >
        Lasso
      </cat-button>
    </div>
    <p class="cal-transfer-stops-map-hint">
      {{ lassoOn ? 'Drag around stops to add them.' : 'Click a stop to add or remove it.' }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maplibre from 'maplibre-gl'
import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps'
import { useRuntimeConfig } from '#imports'

// A stop on the map: where it is, its name, and its routes.
export interface TransferMapStop {
  id: number
  name: string
  routes: string
  lon: number
  lat: number
}

const props = defineProps<{
  // Every stop that can be picked.
  stops: TransferMapStop[]
  // What the map frames when it changes: the subject, say, rather than each
  // stop added.
  fitKey: string
}>()

// The stops picked.
const selected = defineModel<number[]>({ required: true })

const config = useRuntimeConfig()
const frame = ref<HTMLDivElement>()
const mapContainer = ref<HTMLDivElement>()
let map: maplibre.Map | undefined
let popup: maplibre.Popup | undefined

function stopFeatures (): GeoJSON.FeatureCollection {
  const picked = new Set(selected.value)
  return {
    type: 'FeatureCollection',
    features: props.stops.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, routes: s.routes, selected: picked.has(s.id) },
    })),
  }
}

function updateStops () {
  const source = map?.getSource('stops') as maplibre.GeoJSONSource | undefined
  source?.setData(stopFeatures())
}

// The picked stops framed, close enough to tell platforms apart.
function fit () {
  if (!map) {
    return
  }
  const picked = new Set(selected.value)
  const points = props.stops.filter(s => picked.has(s.id))
  if (points.length === 0) {
    return
  }
  const bounds = new maplibre.LngLatBounds()
  for (const p of points) {
    bounds.extend([p.lon, p.lat])
  }
  map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 0 })
}

function toggle (id: number) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}

function escapeHtml (s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c] || c))
}

// The basemap without its labels, as the census map draws it, so the stops'
// own names read clearly.
function protomapsBaseLayers () {
  const labelIds = new Set(
    protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en', labelsOnly: true }).map(l => l.id),
  )
  return protomapsLayers('protomaps-base', namedFlavor('white'), { lang: 'en' })
    .filter(l => !labelIds.has(l.id))
}

function initMap () {
  if (map || !mapContainer.value) {
    return
  }
  const assetOrigin = window.location.origin
  const m = new maplibre.Map({
    container: mapContainer.value,
    zoom: 15,
    center: [-122.4, 45.5],
    style: {
      glyphs: `${assetOrigin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${assetOrigin}/basemaps-assets/sprites/v4/white`,
      version: 8,
      sources: {
        'protomaps-base': {
          type: 'vector',
          tiles: [`https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${config.public.tlv2.protomapsApikey}`],
          maxzoom: 15,
          attribution: '<a href="https://protomaps.com">Protomaps</a> | &copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      },
      layers: protomapsBaseLayers(),
    },
  })
  map = m
  m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
  m.on('load', () => {
    m.addSource('stops', { type: 'geojson', data: stopFeatures() })
    // Picked stops filled, the rest hollow; picked ones drawn on top.
    m.addLayer({
      id: 'stops',
      type: 'circle',
      source: 'stops',
      layout: { 'circle-sort-key': ['case', ['get', 'selected'], 1, 0] },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 8],
        'circle-color': ['case', ['get', 'selected'], '#7a4dda', '#ffffff'],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#5b6470'],
        'circle-stroke-width': 2,
      },
    })
    // Names close in, where platforms sit apart; the picked ones first.
    m.addLayer({
      id: 'stop-names',
      type: 'symbol',
      source: 'stops',
      minzoom: 15,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true,
        'symbol-sort-key': ['case', ['get', 'selected'], 0, 1],
      },
      paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    })
    m.on('click', 'stops', (e) => {
      const id = e.features?.[0]?.properties?.id
      if (typeof id === 'number') {
        toggle(id)
      }
    })
    m.on('mouseenter', 'stops', (e) => {
      m.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (f?.geometry.type === 'Point') {
        const p = f.properties ?? {}
        popup?.remove()
        popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(`<strong>${escapeHtml(String(p.name ?? ''))}</strong>${p.routes ? `<br>${escapeHtml(String(p.routes))}` : ''}`)
          .addTo(m)
      }
    })
    m.on('mouseleave', 'stops', () => {
      m.getCanvas().style.cursor = ''
      popup?.remove()
    })
    // Shown in a panel just opened, the container may have had no size.
    m.resize()
    fit()
  })
}

// The lasso, in the map's screen pixels, while drawn.
const lassoOn = ref(false)
const lassoPoints = ref<[number, number][]>([])
let drawing = false

function point (e: PointerEvent): [number, number] {
  const r = frame.value!.getBoundingClientRect()
  return [e.clientX - r.left, e.clientY - r.top]
}
function startLasso (e: PointerEvent) {
  drawing = true
  try {
    (e.currentTarget as Element).setPointerCapture(e.pointerId)
  } catch {
    // Without capture, a drag past the map's edge ends the lasso there.
  }
  lassoPoints.value = [point(e)]
}
function moveLasso (e: PointerEvent) {
  if (drawing) {
    lassoPoints.value = [...lassoPoints.value, point(e)]
  }
}
// The stops inside the lasso, by where the map draws them, added to those
// picked; then the map pans again.
function endLasso () {
  if (!drawing) {
    return
  }
  drawing = false
  const ring = lassoPoints.value
  lassoPoints.value = []
  lassoOn.value = false
  if (!map || ring.length < 3) {
    return
  }
  const inside = props.stops.filter((s) => {
    const { x, y } = map!.project([s.lon, s.lat])
    return inRing(x, y, ring)
  }).map(s => s.id)
  selected.value = [...new Set([...selected.value, ...inside])]
}
function cancelLasso () {
  drawing = false
  lassoPoints.value = []
}

// Whether a screen point falls inside a drawn ring (even-odd).
function inRing (x: number, y: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

watch([() => props.stops, selected], updateStops)
watch(() => props.fitKey, () => nextTick(fit))

onMounted(() => nextTick(initMap))
onBeforeUnmount(() => {
  popup?.remove()
  map?.remove()
  map = undefined
})
</script>

<style scoped lang="scss">
@import 'maplibre-gl/dist/maplibre-gl';

.cal-transfer-stops-map {
  position: relative;
  min-width: 0;
}

.cal-transfer-stops-map-frame {
  position: relative;
  height: 16rem;
}

.cal-transfer-stops-map-canvas {
  width: 100%;
  height: 100%;
  border: 1px solid var(--bulma-border);
  border-radius: var(--bulma-radius);
}

.cal-transfer-stops-map-lasso {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
  z-index: 2;

  polygon {
    fill: rgba(122, 77, 218, 0.15);
    stroke: #7a4dda;
    stroke-width: 2;
    stroke-dasharray: 4 3;
  }
}

.cal-transfer-stops-map-tools {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 3;
}

.cal-transfer-stops-map-hint {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--bulma-text-weak);
}
</style>
