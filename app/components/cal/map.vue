<template>
  <div class="cal-map-outer">
    <div class="cal-map-share-button">
      <t-button icon-left="share" @click="toggleShareMenu()">
        {{ showShareMenu ? 'Close' : 'Share' }}
      </t-button>
    </div>

    <div v-if="showShareMenu" class="cal-map-share">
      <cal-map-share
        :scenario-filter-result="scenarioFilterResult"
        :census-geographies-selected="censusGeographiesSelected"
      />
    </div>

    <cal-legend
      :data-display-mode="dataDisplayMode"
      :color-key="colorKey"
      :style-data="styleData"
      :has-data="hasData"
      :display-edit-bbox-mode="displayEditBboxMode"
      :hide-unmarked="hideUnmarked"
      :flex-enabled="flexServicesEnabled"
      :flex-color-by="flexColorBy"
      :flex-style-data="flexStyleData"
      :has-flex-data="hasFlexData"
    />

    <cal-map-viewer-ts
      map-class="tall"
      :center="centerPoint"
      :zoom="14"
      :initial-bounds="props.bbox"
      :overlay-features="overlayFeatures"
      :features="displayFeatures"
      :flex-features="flexFeatures"
      :markers="bboxMarkers"
      :popup-features="popupFeatures"
      :loading-stage="props.loadingStage"
      :panel-width="props.panelWidth"
      :fit-bounds-key="fitBoundsKey"
      @map-move="mapMove"
      @map-click-features="mapClickFeatures"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRaw, shallowRef, watch } from 'vue'
import { useToggle } from '@vueuse/core'
import { type CensusGeography, type Stop, stopToStopCsv, type Route, routeToRouteCsv } from '~~/src/tl'
import type { Marker } from 'maplibre-gl'
import type { Bbox, Feature, Point, PopupFeature, MarkerFeature, MarkerDragEvent, DataDisplayMode } from '~~/src/core'
import { colors, routeTypeNames, flexColors } from '~~/src/core'
import type { ScenarioFilterResult } from '~~/src/scenario'

const emit = defineEmits<{
  setBbox: [value: Bbox]
  setMapExtent: [value: Bbox]
  setDisplayFeatures: [value: Feature[]]
  setExportFeatures: [value: Feature[]]
}>()

const props = defineProps<{
  bbox: Bbox
  dataDisplayMode?: DataDisplayMode
  colorKey?: string
  displayEditBboxMode?: boolean
  hideUnmarked?: boolean
  censusGeographiesSelected: CensusGeography[]
  scenarioFilterResult?: ScenarioFilterResult
  // Fixed-Route Transit toggle (on by default)
  fixedRouteEnabled?: boolean
  // Flex Services props
  flexServicesEnabled?: boolean
  flexColorBy?: string
  // Flex display features (pre-filtered and styled from useFlexAreas composable)
  flexDisplayFeatures?: Feature[]
  // Loading stage - allow map updates during geometry stages, skip during schedules
  loadingStage?: string
  // Left padding in pixels to account for overlay panels covering the map
  panelWidth?: number
}>()

const showShareMenu = ref(false)
const toggleShareMenu = useToggle(showShareMenu)

//////////////////
// Map geometries

// Compute initial center point; do not update
const centerPoint: Point = {
  lon: (props.bbox.sw.lon + props.bbox.ne.lon) / 2,
  lat: (props.bbox.sw.lat + props.bbox.ne.lat) / 2
}

// Track fitBounds requests — only refit for external bbox changes, not map-originated drags
const fitBoundsKey = ref(0)
let bboxChangeFromMap = false

watch(() => props.bbox, (newBbox, oldBbox) => {
  if (oldBbox
    && newBbox.sw.lon === oldBbox.sw.lon && newBbox.sw.lat === oldBbox.sw.lat
    && newBbox.ne.lon === oldBbox.ne.lon && newBbox.ne.lat === oldBbox.ne.lat) {
    return
  }
  if (bboxChangeFromMap) {
    bboxChangeFromMap = false
    return
  }
  fitBoundsKey.value++
}, { flush: 'sync' })

interface CornerData {
  marker?: Marker
  element: HTMLElement
  iconElement: HTMLElement
  point: Point
}

// They will be ordered clockwise:  ne, se, sw, nw
let corners: CornerData[] = []

// Arrow icon class for each compass corner, also ordered clockwise
const cornerIcons = [
  'mdi-arrow-top-right', //  ne
  'mdi-arrow-bottom-right', //  se
  'mdi-arrow-bottom-left', //  sw
  'mdi-arrow-top-left' //  nw
]

// Track the bounding box shape during a drag.  This allows us to render
// an updated shape, but only persist the final bbox state on dragend.
const draggingBbox = ref<Bbox | null>(null)

// Track which corner marker is actively being dragged (only one at a time)
// null = no drag in progress, otherwise holds a reference to the marker being dragged
const draggingMarker = shallowRef<Marker | null>(null)

// Polygon for drawing bbox area
const bboxArea = computed(() => {
  const f: Feature[] = []
  const activeBbox = draggingBbox.value || props.bbox
  if (activeBbox.valid && props.displayEditBboxMode) {
    const p = activeBbox
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

// Compute a normalized bbox from the current corner markers
// Because the markers may be dragged, we need to check them.
// This will also fix the corner icons too
function getNormalizedBbox (): Bbox | null {
  if (corners.length !== 4) { return null }
  const copy = corners.slice() // make a copy

  // Determine ranges
  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity

  for (const corner of copy) {
    const { lon, lat } = corner.point

    if (lon < minLon) { minLon = lon }
    if (lat < minLat) { minLat = lat }
    if (lon > maxLon) { maxLon = lon }
    if (lat > maxLat) { maxLat = lat }
  }

  const midLon = (minLon + maxLon) / 2
  const midLat = (minLat + maxLat) / 2

  // Reorder clockwise: ne, se, sw, nw
  // Assign each corner to its quadrant based on position relative to center
  for (const corner of copy) {
    const isRight = corner.point.lon >= midLon
    const isTop = corner.point.lat >= midLat
    const idx = isTop ? (isRight ? 0 : 3) : (isRight ? 1 : 2)
    corners[idx] = corner
    corner.iconElement.className = `mdi ${cornerIcons[idx]}`
  }

  const sw = { lon: minLon, lat: minLat }
  const ne = { lon: maxLon, lat: maxLat }
  return { sw, ne, valid: true } as Bbox
}

// Bbox corner markers — recreated when edit mode toggles on/off or when the bbox prop changes.
// Position updates during drag and after dragEnd are also handled imperatively
const bboxMarkers = computed(() => {
  const result: MarkerFeature[] = []

  if (!props.displayEditBboxMode) {
    return result
  }

  // Read bbox once for initial positions only (not tracked reactively after this)
  const bbox = props.bbox

  // Build the corners array, order as clockwise:  ne, se, sw, nw
  corners = [
    { point: { lon: bbox.ne.lon, lat: bbox.ne.lat } },
    { point: { lon: bbox.ne.lon, lat: bbox.sw.lat } },
    { point: { lon: bbox.sw.lon, lat: bbox.sw.lat } },
    { point: { lon: bbox.sw.lon, lat: bbox.ne.lat } }
  ] as CornerData[]

  for (let i = 0; i < 4; i++) {
    const corner = corners[i]!
    const element = document.createElement('div')
    corner.element = element
    element.className = 'custom-marker'
    const iconElement = document.createElement('i')
    corner.iconElement = iconElement
    iconElement.className = `mdi ${cornerIcons[i]}`
    element.appendChild(iconElement)

    result.push({
      point: corner.point,
      color: '#888',
      draggable: true,
      element,
      onCreated: (marker: Marker) => {
        // We can find the marker again by its element
        const corner = corners.find(c => c.element === marker.getElement())
        if (corner) {
          corner.marker = marker
        }
      },
      onDrag: (e: MarkerDragEvent) => {
        if (corners.length !== 4) { return }
        const marker = e.target
        if (draggingMarker.value === null) {
          draggingMarker.value = marker
        } else if (draggingMarker.value !== e.target) {
          return
        }

        // Update the point corresponding to this marker.
        const { lng, lat } = marker.getLngLat()
        const index = corners.findIndex(c => c.marker === marker)
        if (index === -1) { return } // shouldn't happen
        corners[index]!.point.lon = lng
        corners[index]!.point.lat = lat

        // When dragging a marker, we also need to move its neighbors.
        // The marker at the opposite corner does not move.
        const c0 = corners[0]!
        const c1 = corners[1]!
        const c2 = corners[2]!
        const c3 = corners[3]!

        if (index === 0) { // moving ne
          c3.point.lat = lat
          c3.marker?.setLngLat(c3.point)
          c1.point.lon = lng
          c1.marker?.setLngLat(c1.point)
        } else if (index === 1) { // moving se
          c0.point.lon = lng
          c0.marker?.setLngLat(c0.point)
          c2.point.lat = lat
          c2.marker?.setLngLat(c2.point)
        } else if (index === 2) { // moving sw
          c1.point.lat = lat
          c1.marker?.setLngLat(c1.point)
          c3.point.lon = lng
          c3.marker?.setLngLat(c3.point)
        } else if (index === 3) { // moving nw
          c2.point.lon = lng
          c2.marker?.setLngLat(c2.point)
          c0.point.lat = lat
          c0.marker?.setLngLat(c0.point)
        }

        // Dragging a corner may cause the box to flip, so we renormalize it
        const box = getNormalizedBbox()
        if (box) {
          draggingBbox.value = box
        }
      },
      onDragEnd: (e: MarkerDragEvent) => {
        if (draggingMarker.value !== null && draggingMarker.value !== e.target) {
          return
        }

        const box = getNormalizedBbox()
        draggingMarker.value = null
        draggingBbox.value = null
        if (box) {
          bboxChangeFromMap = true
          emit('setBbox', box)
        }
      }
    })
  }

  return result
})

// Clear marker refs when edit mode is turned off (markers will be removed by drawBboxMarkers)
watch(() => props.displayEditBboxMode, (editing) => {
  if (!editing) {
    corners = []
    draggingMarker.value = null
  }
})

// Lookup for stop features
// This is necessary because the geojson properties are stringified
const stopFeatureLookup = computed(() => {
  const lookup = new Map<string, Stop>()
  for (const feature of props.scenarioFilterResult?.stops || []) {
    lookup.set(feature.id.toString(), toRaw(feature))
  }
  return lookup
})

// Calculate top agencies in result set
// (we will order them by the most to least stops)
interface AgencyData {
  id: string
  name: string
  stops: Set<string>
}
const agencyData = computed((): AgencyData[] => {
  // Collect agency data from the stop data.
  const data = new Map()
  for (const stop of props.scenarioFilterResult?.stops || []) {
    const props = stop
    const route_stops = props.route_stops || []

    for (const rstop of route_stops) {
      // const rid = rstop.route.route_id
      const aid = rstop.route.agency?.agency_id
      const aname = rstop.route.agency?.agency_name
      if (!aid || !aname) {
        continue // no valid agency listed for this stop?
      }

      let adata = data.get(aid)
      if (!adata) { // first time seeing this agency
        adata = {
          id: aid,
          name: aname,
          stops: new Set()
        }
        data.set(aid, adata)
      }
      adata.stops.add(props.stop_id)
    }
  }

  return [...data.values()]
    .sort((a, b) => b.stops.size - a.stops.size) // # stops descending
})

// Depending on the data display, set up matcher rules to choose a styling.
// Matchers should run in the order that they are added to the rules array.
type MatchFunction = (x: Stop | Route) => boolean

interface Matcher {
  label: string
  color: string
  match: MatchFunction
}
const styleData = computed((): Matcher[] => {
  const routeLookup = new Map<number, Route>()
  for (const route of props.scenarioFilterResult?.routes || []) {
    routeLookup.set(route.id, route)
  }

  const stopLookup = new Map<number, Stop>()
  for (const stop of props.scenarioFilterResult?.stops || []) {
    stopLookup.set(stop.id, stop)
  }

  const routeStopLookup = new Map<number, number[]>()
  for (const stop of props.scenarioFilterResult?.stops || []) {
    for (const rs of stop.route_stops) {
      const rid = rs.route.id
      const stops = routeStopLookup.get(rid) || []
      stops.push(stop.id)
      routeStopLookup.set(rid, stops)
    }
  }

  // Style based on AGENCY
  function getAgencyMatcher (val: string): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        return (v as Stop).route_stops.some((rs: any) => rs.route.agency?.agency_id === val)
      } else if (v.__typename === 'Route') {
        return (v as Route).agency?.agency_id === val
      }
      return false
    }
  }

  // Style based on ROUTE MODE
  function getModeMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        // Filter out routes with null/undefined route_type to avoid false matches
        // Also check that route data exists (may still be loading)
        const validRoutes = (v as Stop).route_stops.filter((rs: any) => rs.route && rs.route.route_type != null)
        // If no valid routes, don't match any mode (routes may still be loading)
        if (validRoutes.length === 0) {
          return false
        }
        // Match if ANY route at this stop has this mode (not every)
        // This allows multi-modal stops to match their highest-priority mode
        return validRoutes.some((rs: any) => rs.route.route_type === val)
      } else if (v.__typename === 'Route') {
        // For routes, also check for null/undefined
        if ((v as Route).route_type == null || (v as Route).route_type == undefined) {
          return false
        }
        return (v as Route).route_type === val
      }
      return false
    }
  }

  // Style based on ROUTE FREQUENCY
  function getRouteFrequencyMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        return (v as Stop).route_stops.some((rs: any) => {
          const route = routeLookup.get(rs.route.id)
          const headway = route?.average_frequency || -1
          return headway >= val * 60
        })
      } else if (v.__typename === 'Route') {
        const headway = (v as Route).average_frequency || -1
        return headway >= val * 60
      }
      return false
    }
  }

  // Style based on STOP VISIT COUNT
  function getStopVisitMatcher (val: number): MatchFunction {
    return (v: any) => {
      if (v.__typename === 'Stop') {
        const count = (v as Stop).visits?.total.visit_average || -1
        return count >= val
      } else if (v.__typename === 'Route') {
        const stopIds = routeStopLookup.get((v as Route).id) || []
        return stopIds.some((sid) => {
          const stop = stopLookup.get(sid)
          return (stop?.visits?.total.visit_average || -1) >= val
        })
      }
      return false
    }
  }

  // Generate a set of AGENCY MATCHERS
  function getAgencyMatchers (): Matcher[] {
    const rules: Matcher[] = []
    const agencies = agencyData.value || []
    for (let i = 0; i < Math.min(agencies.length, maxColor); i++) {
      const agency = agencies[i]
      const color = colors[i]
      if (agency && color) {
        rules.push({ label: agency.name ?? '', color: color, match: getAgencyMatcher(agency.id ?? '') })
      }
    }
    return rules
  }

  // Generate a set of MODE MATCHERS (static)
  function getModeMatchers (): Matcher[] {
    const rules: Matcher[] = []
    const modes = [...routeTypeNames.keys()]
    for (let i = 0; i < Math.min(modes.length, maxColor); i++) {
      const mode = modes[i]
      if (mode !== undefined) {
        const label = routeTypeNames.get(mode) || 'Unknown'
        rules.push({ label: label, color: colors[i]!, match: getModeMatcher(mode) })
      }
    }
    return rules
  }

  // Generate a set of ROUTE FREQUENCY MATCHERS (static)
  function getRouteFrequencyMatchers (): Matcher[] {
    const rules: Matcher[] = []
    rules.push({ label: '40+ mins', color: colors[0], match: getRouteFrequencyMatcher(40) })
    rules.push({ label: '30-39 mins', color: colors[1], match: getRouteFrequencyMatcher(30) })
    rules.push({ label: '20-29 mins', color: colors[2], match: getRouteFrequencyMatcher(20) })
    rules.push({ label: '10-19 mins', color: colors[3], match: getRouteFrequencyMatcher(10) })
    rules.push({ label: '0-9 mins', color: colors[4], match: getRouteFrequencyMatcher(0) })
    rules.push({ label: 'Unknown', color: '#000', match: _ => true })
    return rules
  }

  // Generate a set of STOP VISIT MATCHERS (static)
  function getStopVisitMatchers (): Matcher[] {
    const rules: Matcher[] = []
    rules.push({ label: '100+ visits', color: colors[0], match: getStopVisitMatcher(100) })
    rules.push({ label: '50-100 visits', color: colors[1], match: getStopVisitMatcher(50) })
    rules.push({ label: '20-50 visits', color: colors[2], match: getStopVisitMatcher(20) })
    rules.push({ label: '10-20 visits', color: colors[3], match: getStopVisitMatcher(10) })
    rules.push({ label: '0-9 visits', color: colors[4], match: getStopVisitMatcher(0) })
    rules.push({ label: 'Unknown', color: '#000', match: _ => true })
    return rules
  }

  // Reserve an extra color for "other", if needed
  const maxColor = colors.length - 1
  const rules: Matcher[] = []

  // Seven modes
  if (props.dataDisplayMode === 'Agency') {
    rules.push(...getAgencyMatchers())
  } else if (props.dataDisplayMode === 'Route') {
    if (props.colorKey === 'Mode') {
      rules.push(...getModeMatchers())
    } else if (props.colorKey === 'Frequency') {
      rules.push(...getRouteFrequencyMatchers())
    } else if (props.colorKey === 'Fares') {
      // not implemented
    }
  } else if (props.dataDisplayMode === 'Stop') {
    if (props.colorKey === 'Mode') {
      rules.push(...getModeMatchers())
    } else if (props.colorKey === 'Frequency') {
      rules.push(...getStopVisitMatchers())
    } else if (props.colorKey === 'Fares') {
      // not implemented
    }
  }

  // If we used all colors (or no colors), add a catchall "other" rule
  if (rules.length >= maxColor || rules.length === 0) {
    rules.push({ label: 'Other', color: '#000', match: _ => true })
  }

  return rules
})

// Features for display include the all route and stop features.
// Match all features to styling rules and apply as GeoJSON simplestyle
const overlayFeatures = computed((): Feature[] => {
  const forDisplay: Feature[] = []

  // Include bbox in display features
  for (const feature of bboxArea.value) {
    forDisplay.push(toRaw(feature))
  }

  // Include selected features in display features
  for (const feature of props.censusGeographiesSelected) {
    forDisplay.push({
      type: 'Feature',
      id: feature.id.toString(),
      geometry: feature.geometry,
      properties: {}
    })
  }
  return forDisplay
})

const displayFeatures = computed((): Feature[] => {
  // Return empty array if fixed-route transit is disabled
  // (allows user to focus on flex services only)
  if (props.fixedRouteEnabled === false) {
    return []
  }

  const bgColor = '#aaa'
  const bgOpacity = 0.1
  const styleRules = styleData.value || []
  const forDisplay: Feature[] = []

  // Gather routes
  for (const rp of props.scenarioFilterResult?.routes || []) {
    if (props.hideUnmarked && !rp.marked) {
      continue
    }

    const style = styleRules.find(rule => rule.match(rp))
    const feature = {
      type: 'Feature',
      id: rp.id.toString(),
      geometry: rp.geometry,
      properties: {
        'id': rp.id,
        'stroke': style?.color || bgColor,
        'stroke-width': rp.marked ? 2 : 1.0,
        'stroke-opacity': rp.marked ? 1 : bgOpacity,
        'route_id': rp.route_id,
        'route_type': rp.route_type,
        'route_short_name': rp.route_short_name,
        'route_long_name': rp.route_long_name,
        'agency_name': rp.agency?.agency_name,
        'agency_id': rp.agency?.agency_id,
        'marked': rp.marked
      }
    }
    forDisplay.push(feature)
  }

  // Gather stops
  for (const sp of props.scenarioFilterResult?.stops || []) {
    if (props.hideUnmarked && !sp.marked) {
      continue
    }

    const style = styleRules.find(rule => rule.match(sp))
    const feature = {
      type: 'Feature',
      id: sp.id.toString(),
      geometry: sp.geometry,
      properties: {
        'id': sp.id,
        'marker-radius': sp.marked ? 8 : 3,
        'marker-color': style?.color || bgColor,
        'marker-opacity': sp.marked ? 1 : bgOpacity,
        'marked': sp.marked
      }
    }
    forDisplay.push(feature)
  }

  return forDisplay
})

// Features for export include only the "marked" features and the csv column data.
const exportFeatures = computed((): Feature[] => {
  const bgColor = '#aaa'
  const bgOpacity = 0.4
  const styleRules = styleData.value || []
  const forExport: Feature[] = []

  // Gather routes
  for (const rp of props.scenarioFilterResult?.routes || []) {
    if (!rp.marked) {
      continue
    }

    const style = styleRules.find(rule => rule.match(rp))
    const feature = {
      type: 'Feature',
      id: rp.id.toString(),
      geometry: rp.geometry,
      properties: {
        'id': rp.id,
        'stroke': style?.color || bgColor,
        'stroke-width': rp.marked ? 3 : 0.75,
        'stroke-opacity': rp.marked ? 1 : bgOpacity,
        'agency_name': rp.agency?.agency_name,
        'agency_id': rp.agency?.agency_id
      }
    }
    Object.assign(feature.properties, routeToRouteCsv(rp))
    forExport.push(feature)
  }

  // Gather stops
  for (const sp of props.scenarioFilterResult?.stops || []) {
    if (!sp.marked) {
      continue
    }

    const style = styleRules.find(rule => rule.match(sp))
    const feature = {
      type: 'Feature',
      id: sp.id.toString(),
      geometry: sp.geometry,
      properties: {
        'id': sp.id,
        'marker-radius': sp.marked ? 8 : 4,
        'marker-color': style?.color || bgColor,
        'marker-opacity': sp.marked ? 1 : bgOpacity
      }
    }
    Object.assign(feature.properties, stopToStopCsv(sp))
    forExport.push(feature)
  }

  return forExport
})

watch(displayFeatures, () => {
  emit('setDisplayFeatures', displayFeatures.value)
})

watch(exportFeatures, () => {
  emit('setExportFeatures', exportFeatures.value)
})

/**
 * Flex service area features for the map layer
 * Returns empty array if flex is disabled (similar to how displayFeatures handles fixedRouteEnabled)
 */
const flexFeatures = computed((): Feature[] => {
  if (!props.flexServicesEnabled) { return [] }
  return props.flexDisplayFeatures || []
})

// Is there fixed-route data to display?
const hasData = computed((): boolean => {
  if (props.fixedRouteEnabled === false) {
    return false
  }
  return !!(props.scenarioFilterResult?.stops.length || props.scenarioFilterResult?.routes.length)
})

// Does flex have data to display?
const hasFlexData = computed((): boolean => {
  return !!(props.flexServicesEnabled && props.flexDisplayFeatures?.length)
})

/**
 * Style data for flex service areas in the legend
 * - Agency mode: No color swatches (too many agencies, user clicks/hovers for details)
 * - Advance notice mode: Three swatches for booking categories
 */
const flexStyleData = computed(() => {
  if (!props.flexServicesEnabled || !props.flexDisplayFeatures?.length) {
    return []
  }

  const colorBy = props.flexColorBy || 'Agency'

  if (colorBy === 'Advance notice') {
    // Show advance notice categories with their semantic colors
    return [
      { label: 'On-demand', color: flexColors.advanceNotice['On-demand'] },
      { label: 'Same day', color: flexColors.advanceNotice['Same day'] },
      { label: 'More than 24 hours', color: flexColors.advanceNotice['More than 24 hours'] },
    ]
  } else {
    // Agency mode: No color swatches - users click/hover on polygons to see agency names
    return []
  }
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
  const seenIds = new Set<string>() // Deduplicate features by ID (same feature may be returned from multiple layers)

  console.log(`[MapClick] ${features.length} raw features at point`)

  for (const feature of features) {
    const featureId = feature.id?.toString() || ''

    // Only dedupe if we have a valid ID (skip deduplication for empty IDs)
    if (featureId && seenIds.has(featureId)) {
      continue // Skip duplicate
    }
    if (featureId) {
      seenIds.add(featureId)
    }

    const ft = feature.geometry.type
    const fp = feature.properties

    let popupFeature: PopupFeature | undefined = undefined

    if (ft === 'Point') {
      const stopLookup = stopFeatureLookup.value.get(featureId)
      if (!stopLookup) {
        continue
      }
      const sp = stopLookup
      popupFeature = {
        point: { lon: pt.lng, lat: pt.lat },
        featureId: featureId,
        sourceLayer: 'points',
        featureType: 'stop',
        data: {
          stop_id: sp.stop_id,
          stop_name: sp.stop_name,
          routes: sp.route_stops.map((rs: any) => rs.route.route_short_name),
          agencies: sp.route_stops.map((rs: any) => rs.route.agency.agency_name),
        }
      }
    } else if (ft === 'LineString' || ft === 'MultiLineString') {
      popupFeature = {
        point: { lon: pt.lng, lat: pt.lat },
        featureId: featureId,
        sourceLayer: 'lines',
        featureType: 'route',
        data: {
          route_id: fp.route_id,
          route_short_name: fp.route_short_name || '',
          route_long_name: fp.route_long_name || '',
          route_type_name: routeTypeNames.get(fp.route_type) || 'Unknown',
          agency_name: fp.agency_name,
        }
      }
    } else if ((ft === 'Polygon' || ft === 'MultiPolygon') && fp.location_id) {
      // Flex service area popup
      // Use location_id from properties as the feature ID (more reliable than feature.id from MapLibre query)
      const flexFeatureId = fp.location_id?.toString() || featureId
      popupFeature = {
        point: { lon: pt.lng, lat: pt.lat },
        featureId: flexFeatureId,
        sourceLayer: 'flexPolygons',
        featureType: 'flex',
        data: {
          location_id: fp.location_id,
          location_name: fp.location_name,
          agency_name: fp.agency_name || fp.agency_names || 'Unknown',
          route_names: fp.route_names || 'Unknown',
          area_type: fp.area_type || 'Unknown',
          advance_notice: fp.advance_notice || 'Unknown',
          phone_number: fp.phone_number,
          marked: fp.marked,
        }
      }
    }

    if (popupFeature) {
      console.log(`[MapClick] Adding popup feature: featureId=${popupFeature.featureId}, sourceLayer=${popupFeature.sourceLayer}`)
      a.push(popupFeature)
    }
  }

  console.log(`[MapClick] ${a.length} unique features after processing`)
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
  z-index:10;
}
.cal-map-share {
  position:absolute;
  right:50px;
  top:50px;
  width:300px;
  color:black;
  padding:5px;
  height:150px;
  z-index:10;
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
