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
        size="small"
        icon-left="lasso"
        :variant="lassoOn ? 'primary' : undefined"
        v-bind="{ 'aria-pressed': lassoOn }"
        @click="lassoOn = !lassoOn"
      >
        Lasso
      </cat-button>
      <cat-button v-if="inView.some(id => !picked.has(id))" size="small" @click="selectInView">
        Select all in view
      </cat-button>
      <cat-button v-if="selected.length > 0" size="small" @click="selected = []">
        Unselect all
      </cat-button>
    </div>
    <p class="cal-transfer-stops-map-hint">
      <span class="cal-transfer-stops-map-key"><span class="cal-transfer-stops-map-key-stop" />Stop</span>
      <span class="cal-transfer-stops-map-key"><span class="cal-transfer-stops-map-key-platform" />Platform</span>
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
import { escapeHtml } from '~~/src/core'
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
  // The routes that serve it.
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
  // The query's area, outlined, as no stops outside it are loaded; and the
  // map pans no further than a little past it.
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

// The layers' filters: the stops picked, and the rest.
function pickedFilter (picked: boolean): maplibre.FilterSpecification {
  const isPicked: maplibre.FilterSpecification = ['in', ['get', 'id'], ['literal', selected.value]]
  return picked ? isPicked : ['!', isPicked]
}

// Every route's line, set on the map only when the routes change.
function routeFeatures (): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: props.routes.map(r => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: { id: r.id, name: r.name, operator: r.operator, color: r.color ? `#${r.color}` : UNPICKED },
    })),
  }
}

// The routes at a picked stop, drawn full; the rest, dimmed.
const pickedRoutes = computed(() => {
  const picked = new Set(selected.value)
  return [...new Set(props.stops.filter(s => picked.has(s.id)).flatMap(s => s.routeIds))]
})
function routeFilter (picked: boolean): maplibre.FilterSpecification {
  const isPicked: maplibre.FilterSpecification = ['in', ['get', 'id'], ['literal', pickedRoutes.value]]
  return picked ? isPicked : ['!', isPicked]
}

// The extent's bounding box, padded by a fifth of its size (and at least
// about 500 m), for the map's panning bounds; none without an extent.
function extentBounds (): maplibre.LngLatBounds | undefined {
  const b = new maplibre.LngLatBounds()
  const visit = (c: any) => {
    if (typeof c[0] === 'number') {
      b.extend([c[0], c[1]])
    } else {
      c.forEach(visit)
    }
  }
  for (const f of props.extent) {
    visit((f.geometry as { coordinates?: unknown }).coordinates ?? [])
  }
  if (b.isEmpty()) {
    return undefined
  }
  const padLon = Math.max((b.getEast() - b.getWest()) / 5, 0.006)
  const padLat = Math.max((b.getNorth() - b.getSouth()) / 5, 0.0045)
  return new maplibre.LngLatBounds([b.getWest() - padLon, b.getSouth() - padLat], [b.getEast() + padLon, b.getNorth() + padLat])
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
    map.setFilter('stops', pickedFilter(false))
    map.setFilter('stops-picked', pickedFilter(true))
    map.setFilter('routes', routeFilter(false))
    map.setFilter('routes-picked', routeFilter(true))
  }
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
  map.fitBounds(bounds, { padding: 48, maxZoom: 19, duration: 0 })
}

function toggle (id: number) {
  selected.value = selected.value.includes(id) ? selected.value.filter(x => x !== id) : [...selected.value, id]
}

// The map's view, west, south, east, north; and the stops in it.
const bounds = ref<[number, number, number, number]>()
const picked = computed(() => new Set(selected.value))
const inView = computed(() => {
  const v = bounds.value
  return v ? props.stops.filter(s => s.lon >= v[0] && s.lat >= v[1] && s.lon <= v[2] && s.lat <= v[3]).map(s => s.id) : []
})
function selectInView () {
  selected.value = [...new Set([...selected.value, ...inView.value])]
}

function emitView () {
  const b = map?.getBounds()
  if (b) {
    bounds.value = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    emit('view', bounds.value)
  }
}

// A marker: a circle for a stop, a rounded square for a platform; filled
// when picked, hollow otherwise.
const MARKER_SIZE = 20
// As close as the map goes, a few meters across a marker; and as far out,
// a couple of kilometers across, past any walk between stops.
const MAX_ZOOM = 21
const MIN_ZOOM = 14
const PICKED = '#7a4dda'
const UNPICKED = '#5b6470'
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
  ctx.fillStyle = picked ? PICKED : '#ffffff'
  ctx.fill()
  ctx.lineWidth = 2 * ratio
  ctx.strokeStyle = picked ? '#ffffff' : UNPICKED
  ctx.stroke()
  return ctx.getImageData(0, 0, size, size)
}

// A stop as text: its name, a platform's note, operator, and routes.
function stopHtml (p: Record<string, any>): string {
  return [
    `<strong>${escapeHtml(String(p.name ?? ''))}</strong>${p.platform ? ' (platform)' : ''}`,
    p.operator ? escapeHtml(String(p.operator)) : '',
    p.routes ? `<span class="cal-transfer-stops-map-routes">${escapeHtml(String(p.routes))}</span>` : '',
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
  root.className = 'cal-transfer-stops-map-chooser'
  const picked = new Set(selected.value)
  for (const f of features) {
    const id = f.properties?.id as number
    const label = document.createElement('label')
    const box = document.createElement('input')
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
        filter: routeFilter(picked),
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
      paint: { 'line-color': '#5b6470', 'line-width': 1.5, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
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
        'circle-color': PICKED,
        'circle-opacity': 0.25,
        'circle-stroke-color': PICKED,
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
        filter: pickedFilter(picked),
        layout: {
          'icon-image': ['concat', 'marker-', ['case', ['get', 'platform'], 'platform', 'stop'], picked ? '-picked' : '-other'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 16, 1, 18, 1.2],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      })
    }
    // No names drawn: they crowd a station's stops. Hovering a stop, or its
    // row in the list, names it.
    // Several stops under the pointer are listed together. Clicking one picks
    // it; clicking several zooms in on them, to set them apart, and once
    // zoomed all the way in, opens a list to pick among them.
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

watch(() => props.stops, updateStops)
watch(() => props.routes, updateRoutes)
watch(selected, updatePicked)
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
  display: flex;
  gap: 0.35rem;
}

:deep(.cal-transfer-stops-map-chooser) {
  display: grid;
  gap: 0.35rem;
  font-size: 0.8rem;

  label {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    cursor: pointer;
  }

  input {
    margin-top: 0.2rem;
  }
}

:deep(.cal-transfer-stops-map-routes) {
  color: #5b6470;
}

.cal-transfer-stops-map-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem 0.75rem;
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--bulma-text-weak);
}

// The legend's shapes, as the map draws them, unpicked.
.cal-transfer-stops-map-key {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.cal-transfer-stops-map-key-stop,
.cal-transfer-stops-map-key-platform {
  display: inline-block;
  width: 0.65rem;
  height: 0.65rem;
  border: 2px solid #5b6470;
  background: #ffffff;
}

.cal-transfer-stops-map-key-route {
  display: inline-block;
  width: 1rem;
  height: 2px;
  background: #5b6470;
  opacity: 0.5;
}

.cal-transfer-stops-map-key-route-other {
  height: 1px;
  opacity: 0.25;
}

.cal-transfer-stops-map-key-extent {
  display: inline-block;
  width: 1rem;
  border-top: 2px dashed #5b6470;
}

.cal-transfer-stops-map-key-stop {
  border-radius: 50%;
}

.cal-transfer-stops-map-key-platform {
  border-radius: 2px;
}
</style>
