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
        class="cal-transfer-stops-map-lasso"
        @pointerdown="startLasso"
        @pointermove="moveLasso"
        @pointerup="endLasso"
        @pointercancel="cancelLasso"
      >
        <polygon v-if="lassoPoints.length > 1" :points="lassoPoints.map(p => p.join(',')).join(' ')" />
      </svg>
    </div>
    <div class="cal-transfer-stops-map-tools">
      <cat-button
        icon-left="lasso"
        :variant="lassoOn ? 'primary' : undefined"
        v-bind="{ 'aria-pressed': lassoOn }"
        @click="lassoOn = !lassoOn"
      >
        Lasso
      </cat-button>
    </div>
    <p class="cal-transfer-stops-map-hint mt-2 has-text-grey">
      <span class="cal-transfer-stops-map-key"><cat-icon size="small" icon="circle-outline" />Stop</span>
      <span class="cal-transfer-stops-map-key"><cat-icon size="small" icon="square-rounded-outline" />Platform</span>
      <span v-if="routes.length > 0" class="cal-transfer-stops-map-key"><span class="cal-transfer-stops-map-key-route" />Route at a picked stop</span>
      <span v-if="routes.length > 0" class="cal-transfer-stops-map-key"><span class="cal-transfer-stops-map-key-route cal-transfer-stops-map-key-route-other" />Other route</span>
      <span v-if="extent.length > 0" class="cal-transfer-stops-map-key"><span class="cal-transfer-stops-map-key-extent" />Query area</span>
      <span>{{ lassoOn ? 'Drag around stops to add them.' : 'Click a stop to add or remove it.' }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as maplibre from 'maplibre-gl'
import bbox from '@turf/bbox'
import { TRANSFER_PICKED_COLOR, TRANSFER_UNPICKED_COLOR, escapeHtml } from '~~/src/core'
import { basemapStyle } from '~/utils/basemap'
import { useRuntimeConfig } from '#imports'

// A stop on the map: where it is, its name, its operators and routes, and
// whether it is a platform in a station (has a parent station).
export interface TransferMapStop {
  id: number
  name: string
  operator: string
  routes: string
  platform: boolean
  // The stop's routes.
  routeIds: number[]
  lon: number
  lat: number
}

// A route at the stops, drawn by its representative line in its color.
export interface TransferMapRoute {
  id: number
  name: string
  operator: string
  // GTFS route_color: hex without the '#'.
  color?: string
  geometry: GeoJSON.MultiLineString
}

const props = defineProps<{
  // Every stop that can be picked.
  stops: TransferMapStop[]
  // The routes at those stops.
  routes: TransferMapRoute[]
  // The query's area, outlined since no stops outside the area are loaded;
  // the map pans only a little past the area.
  extent: GeoJSON.Feature[]
  // What the map frames when it changes: the subject, say, rather than each
  // stop added.
  fitKey: string
  // A stop to ring, as the list's row under the pointer.
  highlight?: number
}>()

// The stops picked.
const selected = defineModel<number[]>({ required: true })

const emit = defineEmits<{
  // The map's view, as west, south, east, north, when it settles.
  view: [bounds: [number, number, number, number]]
  // The stop under the pointer, for the list to mark; none as it leaves.
  hover: [id: number | undefined]
}>()

const config = useRuntimeConfig()
const frame = ref<HTMLDivElement>()
const mapContainer = ref<HTMLDivElement>()
let map: maplibre.Map | undefined
let popup: maplibre.Popup | undefined
// Open while picking among stops drawn on top of one another.
let chooser: maplibre.Popup | undefined

// Every stop, set on the map only when the stops change; which are picked
// is a filter on the layers that draw them.
function stopFeatures (): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.stops.map(s => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { id: s.id, name: s.name, operator: s.operator, routes: s.routes, platform: s.platform },
    })),
  }
}

// A layer's filter: the features whose id is among the ids, or the rest.
function idFilter (ids: number[], among: boolean): maplibre.FilterSpecification {
  const isAmong: maplibre.FilterSpecification = ['in', ['get', 'id'], ['literal', ids]]
  return among ? isAmong : ['!', isAmong]
}

// Every route's line, set on the map only when the routes change.
function routeFeatures (): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.routes.map(r => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: { id: r.id, name: r.name, operator: r.operator, color: r.color ? `#${r.color}` : TRANSFER_UNPICKED_COLOR },
    })),
  }
}

// The routes at a picked stop, drawn full; the rest, dimmed.
const pickedRoutes = computed(() => {
  const picked = new Set(selected.value)
  return [...new Set(props.stops.filter(s => picked.has(s.id)).flatMap(s => s.routeIds))]
})

// The extent's bounding box, padded by a fifth of its size (and at least
// about 500 m), for the map's panning bounds; none without an extent.
function extentBounds (): maplibre.LngLatBounds | undefined {
  const [west, south, east, north] = bbox({ type: 'FeatureCollection', features: props.extent })
  if (!Number.isFinite(west)) {
    return undefined
  }
  const padLon = Math.max((east - west) / 5, 0.006)
  const padLat = Math.max((north - south) / 5, 0.0045)
  return new maplibre.LngLatBounds([west - padLon, south - padLat], [east + padLon, north + padLat])
}

function updateExtent () {
  if (!map) {
    return
  }
  const source = map.getSource('extent') as maplibre.GeoJSONSource | undefined
  source?.setData({ type: 'FeatureCollection', features: props.extent })
  map.setMaxBounds(extentBounds() ?? null)
}

function updateStops () {
  const source = map?.getSource('stops') as maplibre.GeoJSONSource | undefined
  source?.setData(stopFeatures())
}

function updateRoutes () {
  const source = map?.getSource('routes') as maplibre.GeoJSONSource | undefined
  source?.setData(routeFeatures())
}

function updatePicked () {
  if (map?.getLayer('stops-picked')) {
    map.setFilter('stops', idFilter(selected.value, false))
    map.setFilter('stops-picked', idFilter(selected.value, true))
    map.setFilter('routes', idFilter(pickedRoutes.value, false))
    map.setFilter('routes-picked', idFilter(pickedRoutes.value, true))
  }
}

// Frames the picked stops, close enough to tell platforms apart.
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
  map.fitBounds(bounds, { padding: 48, maxZoom: 19, duration: 0 })
}

function toggle (id: number) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}

// The map's view, west, south, east, north, for the list.
function emitView () {
  const b = map?.getBounds()
  if (b) {
    emit('view', [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
  }
}

const MARKER_SIZE = 20
// As close as the map goes, a few meters across a marker; and as far out,
// a couple of kilometers across, past any walk between stops.
const MAX_ZOOM = 21
const MIN_ZOOM = 14
// A marker: a circle for a stop, a rounded square for a platform; filled
// when picked, white otherwise.
function marker (platform: boolean, picked: boolean): ImageData {
  const ratio = 2
  const size = MARKER_SIZE * ratio
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const inset = 3 * ratio
  ctx.beginPath()
  if (platform) {
    ctx.roundRect(inset, inset, size - 2 * inset, size - 2 * inset, 2 * ratio)
  } else {
    ctx.arc(size / 2, size / 2, size / 2 - inset, 0, Math.PI * 2)
  }
  ctx.fillStyle = picked ? TRANSFER_PICKED_COLOR : '#ffffff'
  ctx.fill()
  ctx.lineWidth = 2 * ratio
  ctx.strokeStyle = picked ? '#ffffff' : TRANSFER_UNPICKED_COLOR
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

// A stop as text: its name, a platform's note, operator, and routes.
function stopHtml (p: Record<string, any>): string {
  return [
    `<strong>${escapeHtml(String(p.name ?? ''))}</strong>${p.platform ? ' (platform)' : ''}`,
    p.operator ? escapeHtml(String(p.operator)) : '',
    p.routes ? `<span class="has-text-grey">${escapeHtml(String(p.routes))}</span>` : '',
  ].filter(Boolean).join('<br>')
}

// The stops under a point, within a few pixels: one, or several drawn on top
// of one another.
function stopsAt (m: maplibre.Map, point: maplibre.Point): maplibre.MapGeoJSONFeature[] {
  const r = 8
  const seen = new Set<number>()
  return m.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers: ['stops-picked', 'stops'] })
    .filter((f) => {
      const id = f.properties?.id as number
      return !seen.has(id) && !!seen.add(id)
    })
}

// The routes under a point, within a few pixels, as text: each one's name
// and operator; empty for none.
function routesAt (m: maplibre.Map, e: maplibre.MapMouseEvent): string {
  const r = 4
  const features = m.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['routes-picked', 'routes'] })
  const names = new Map(features.map(f => [f.properties?.id as number, f.properties ?? {}]))
  return [...names.values()]
    .map(p => `<strong>${escapeHtml(String(p.name ?? ''))}</strong>${p.operator ? ` ${escapeHtml(String(p.operator))}` : ''}`)
    .join('<br>')
}

// A list of the stops at a point, each with a checkbox, to pick among stops
// drawn on top of one another.
function chooserContent (features: maplibre.MapGeoJSONFeature[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'is-flex is-flex-direction-column is-gap-1'
  const picked = new Set(selected.value)
  for (const f of features) {
    const id = f.properties?.id as number
    const label = document.createElement('label')
    label.className = 'checkbox is-flex is-align-items-flex-start is-gap-1'
    const box = document.createElement('input')
    box.className = 'mt-1'
    box.type = 'checkbox'
    box.checked = picked.has(id)
    box.addEventListener('change', () => toggle(id))
    const text = document.createElement('span')
    text.innerHTML = stopHtml(f.properties ?? {})
    label.append(box, text)
    root.append(label)
  }
  return root
}

function showHover (m: maplibre.Map, features: maplibre.MapGeoJSONFeature[]) {
  const f = features[0]
  if (!f || f.geometry.type !== 'Point' || chooser?.isOpen()) {
    return
  }
  popup?.remove()
  popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 12, maxWidth: '18rem' })
    .setLngLat(f.geometry.coordinates as [number, number])
    .setHTML(features.length > 1
      ? `${features.map(x => stopHtml(x.properties ?? {})).join('<hr>')}<br><em>Click to set these ${features.length} apart</em>`
      : stopHtml(f.properties ?? {}))
    .addTo(m)
}

function setHighlight (id: number | undefined) {
  if (map?.getLayer('stop-highlight')) {
    map.setFilter('stop-highlight', ['==', ['get', 'id'], id ?? -1])
  }
}

function initMap () {
  if (map || !mapContainer.value) {
    return
  }
  const m = new maplibre.Map({
    container: mapContainer.value,
    zoom: 15,
    maxZoom: MAX_ZOOM,
    minZoom: MIN_ZOOM,
    // The buttons zoom, not the wheel, a double click, a box, or a pinch, so
    // scrolling the page across the map never zooms the map.
    scrollZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    touchZoomRotate: false,
    center: [-122.4, 45.5],
    // The map data's credits only, not MapLibre's own, which the control
    // adds by default.
    attributionControl: { compact: true },
    // Without the basemap's labels, so the stops read clearly.
    style: basemapStyle(config.public.tlv2.protomapsApikey),
  })
  map = m
  m.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right')
  m.on('load', () => {
    // The routes' lines under all else, for orientation only, so thin and
    // faint: those at a picked stop less so than the rest.
    m.addSource('routes', { type: 'geojson', data: routeFeatures() })
    for (const picked of [false, true]) {
      m.addLayer({
        id: picked ? 'routes-picked' : 'routes',
        type: 'line',
        source: 'routes',
        filter: idFilter(pickedRoutes.value, picked),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': picked ? 2 : 1,
          'line-opacity': picked ? 0.5 : 0.2,
        },
      })
    }
    // The query's area, dashed, under the stops.
    m.addSource('extent', { type: 'geojson', data: { type: 'FeatureCollection', features: props.extent } })
    m.addLayer({
      id: 'extent',
      type: 'line',
      source: 'extent',
      paint: { 'line-color': TRANSFER_UNPICKED_COLOR, 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    })
    m.setMaxBounds(extentBounds() ?? null)
    m.addSource('stops', { type: 'geojson', data: stopFeatures() })
    for (const platform of [false, true]) {
      for (const picked of [false, true]) {
        m.addImage(`marker-${platform ? 'platform' : 'stop'}-${picked ? 'picked' : 'other'}`, marker(platform, picked), { pixelRatio: 2 })
      }
    }
    // A ring around the stop under the pointer, here or in the list.
    m.addLayer({
      id: 'stop-highlight',
      type: 'circle',
      source: 'stops',
      filter: ['==', ['get', 'id'], -1],
      paint: {
        'circle-radius': 16,
        'circle-color': TRANSFER_PICKED_COLOR,
        'circle-opacity': 0.25,
        'circle-stroke-color': TRANSFER_PICKED_COLOR,
        'circle-stroke-width': 2,
      },
    })
    // Stops as circles and platforms as squares, picked ones filled, in a
    // layer of their own drawn on top.
    for (const picked of [false, true]) {
      m.addLayer({
        id: picked ? 'stops-picked' : 'stops',
        type: 'symbol',
        source: 'stops',
        filter: idFilter(selected.value, picked),
        layout: {
          'icon-image': ['concat', 'marker-', ['case', ['get', 'platform'], 'platform', 'stop'], picked ? '-picked' : '-other'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 16, 1, 18, 1.2],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }
    // Hovering names a stop, as names drawn on the map would crowd a
    // station's stops. A click on one stop toggles that stop; on several, it
    // zooms in to set them apart, and at full zoom lists them with checkboxes.
    let hovered: number | undefined
    let hoveredRoutes = ''
    m.on('mousemove', (e) => {
      const features = stopsAt(m, e.point)
      const id = features[0]?.properties?.id as number | undefined
      m.getCanvas().style.cursor = id === undefined ? '' : 'pointer'
      if (id !== hovered) {
        hovered = id
        emit('hover', id)
        setHighlight(id)
        hoveredRoutes = ''
        popup?.remove()
        if (id !== undefined) {
          showHover(m, features)
        }
      }
      // Off the stops, the routes under the pointer, named.
      const names = id === undefined ? routesAt(m, e) : ''
      if (names !== hoveredRoutes) {
        hoveredRoutes = names
        popup?.remove()
        if (names && !chooser?.isOpen()) {
          popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 8, maxWidth: '18rem' })
            .setLngLat(e.lngLat)
            .setHTML(names)
            .addTo(m)
        }
      }
    })
    m.getCanvas().addEventListener('mouseleave', () => {
      hovered = undefined
      hoveredRoutes = ''
      emit('hover', undefined)
      setHighlight(props.highlight)
      popup?.remove()
    })
    m.on('click', (e) => {
      const features = stopsAt(m, e.point)
      const f = features[0]
      if (!f || f.geometry.type !== 'Point') {
        return
      }
      if (features.length === 1) {
        toggle(f.properties?.id as number)
        return
      }
      if (m.getZoom() < MAX_ZOOM - 0.5) {
        popup?.remove()
        m.easeTo({ center: f.geometry.coordinates as [number, number], zoom: Math.min(m.getZoom() + 2, MAX_ZOOM) })
        return
      }
      popup?.remove()
      chooser?.remove()
      chooser = new maplibre.Popup({ closeButton: true, closeOnClick: true, offset: 12, maxWidth: '18rem' })
        .setLngLat(f.geometry.coordinates as [number, number])
        .setDOMContent(chooserContent(features))
        .addTo(m)
    })
    // Shown in a panel just opened, the container may have had no size.
    m.resize()
    fit()
    emitView()
  })
  m.on('moveend', emitView)
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
    lassoPoints.value.push(point(e))
  }
}
// Adds the stops inside the lasso, by where the map draws them, to those
// picked, and turns the lasso off so a drag pans the map again.
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

watch(() => props.stops, updateStops)
watch(() => props.routes, updateRoutes)
// The picked stops' routes follow the stops too, as a filter changes them.
watch([selected, pickedRoutes], updatePicked)
watch(() => props.highlight, setHighlight)
watch(() => props.extent, updateExtent)
watch(() => props.fitKey, () => nextTick(fit))

onMounted(() => nextTick(initMap))
onBeforeUnmount(() => {
  popup?.remove()
  chooser?.remove()
  map?.remove()
  map = undefined
})
</script>

<style scoped lang="scss">
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
    fill: color-mix(in srgb, v-bind(TRANSFER_PICKED_COLOR) 15%, transparent);
    stroke: v-bind(TRANSFER_PICKED_COLOR);
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
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 1rem;
}

// The legend's swatches, as the map draws them.
.cal-transfer-stops-map-key {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.cal-transfer-stops-map-key-route {
  width: 1rem;
  height: 2px;
  background: v-bind(TRANSFER_UNPICKED_COLOR);
  opacity: 0.5;
}

.cal-transfer-stops-map-key-route-other {
  height: 1px;
  opacity: 0.25;
}

.cal-transfer-stops-map-key-extent {
  width: 1rem;
  border-top: 2px dashed v-bind(TRANSFER_UNPICKED_COLOR);
}
</style>
