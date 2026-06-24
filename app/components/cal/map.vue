<template>
  <div class="cal-map-outer">
    <div class="cal-map-share-button">
      <cat-button icon-left="share" @click="toggleShareMenu()">
        {{ showShareMenu ? 'Close' : 'Share' }}
      </cat-button>
    </div>

    <div v-if="showShareMenu" class="cal-map-share">
      <cal-map-share
        :scenario-filter-result="scenarioFilterResult"
        :census-geographies-selected="censusGeographiesSelected"
        :export-features="exportFeatures"
      />
    </div>

    <!-- Slotted panels render above the legend; chrome shared via cat-msg. -->
    <div class="cal-map-sidebar">
      <slot name="sidebar-top" />
      <cal-legend
        :style-data="styleData"
        :has-data="hasData"
        :display-edit-bbox-mode="displayEditBboxMode"
        :show-bbox="showBbox"
        :flex-enabled="flexServicesEnabled"
        :flex-color-by="flexColorBy"
        :flex-style-data="flexStyleData"
        :has-flex-data="hasFlexData"
        :has-choropleth-data="!!(props.choroplethFeatures && props.choroplethFeatures.length > 0)"
        :choropleth-classification="props.choroplethClassification"
        :has-cluster-data="hasClusterData"
        @view-details="emit('viewCensusDetails')"
      />
    </div>

    <cal-map-viewer-ts
      map-class="tall"
      :center="centerPoint"
      :zoom="14"
      :initial-bounds="bbox"
      :overlay-features="overlayFeatures"
      :choropleth-features="props.choroplethFeatures || []"
      :selectable-geographies="selectableGeographies"
      :features="displayFeatures"
      :flex-features="flexFeatures"
      :cluster-features="clusterFeatures"
      :cluster-circle-features="clusterCircleFeatures"
      :cluster-line-features="clusterLineFeatures"
      :cluster-markers="clusterMarkers"
      :markers="bboxMarkers"
      :popup-features="popupFeatures"
      :loading-stage="props.loadingStage"
      :panel-width="props.panelWidth"
      :fit-bounds-key="fitBoundsKey"
      :fit-overlay-key="props.fitOverlayKey"
      :fit-target-features="fitTargetFeatures"
      @map-move="mapMove"
      @map-click-features="mapClickFeatures"
      @selectable-geo-click="onSelectableGeoClick"
      @selectable-geo-right-click="onSelectableGeoRightClick"
      @overlay-drag-start="onOverlayDragStart"
      @overlay-drag="onOverlayDrag"
      @overlay-drag-end="onOverlayDragEnd"
      @open-timetable="handleOpenTimetable"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRaw, shallowRef, watch } from 'vue'
import { useToggle } from '@vueuse/core'
import { type CensusGeography, type Stop, stopToStopCsv, type Route, routeToRouteCsv } from '~~/src/tl'
import type { Marker } from 'maplibre-gl'
import type { Bbox, Feature, Point, PopupFeature, MarkerFeature, MarkerDragEvent, ChoroplethClassification, ClusterMemberInfo } from '~~/src/core'
import { colors, categoricalColors, routeTypeNames, flexColors, createCategoryColorScale } from '~~/src/core'
import type { ScenarioFilterResult, StopCluster } from '~~/src/scenario'

const emit = defineEmits<{
  setMapExtent: [value: Bbox]
  setDisplayFeatures: [value: Feature[]]
  setExportFeatures: [value: Feature[]]
  toggleGeography: [geographyId: number]
  openTimetable: [route: Route]
  selectAggregation: [row: Record<string, any>]
  viewCensusDetails: []
}>()

const props = defineProps<{
  displayEditBboxMode?: boolean
  showBbox?: boolean
  censusGeographiesSelected: CensusGeography[]
  // Viewport geographies for click-to-select in adminBoundary mode
  viewportGeographies?: CensusGeography[]
  scenarioFilterResult?: ScenarioFilterResult
  // Choropleth aggregation overlay
  choroplethFeatures?: Feature[]
  choroplethClassification?: ChoroplethClassification
  // Flex display features (pre-filtered and styled from useFlexAreas composable)
  flexDisplayFeatures?: Feature[]
  // Loading stage - allow map updates during geometry stages, skip during schedules
  loadingStage?: string
  // Left padding in pixels to account for overlay panels covering the map
  panelWidth?: number
  // Increment to fit map to overlay features
  fitOverlayKey?: number
}>()

const { dataDisplayMode, hideUnmarked } = useScenarioDisplay()
const { bbox, geographyIds, geomSource, geomLayer, fixedRouteEnabled } = useScenarioInputs()
const { flexServicesEnabled, flexColorBy } = useScenarioFilters()

const showShareMenu = ref(false)
const toggleShareMenu = useToggle(showShareMenu)

//////////////////
// Map geometries

// Compute initial center point; do not update
const centerPoint: Point = {
  lon: (bbox.value.sw.lon + bbox.value.ne.lon) / 2,
  lat: (bbox.value.sw.lat + bbox.value.ne.lat) / 2
}

// Track fitBounds requests — only refit for external bbox changes, not map-originated drags
const fitBoundsKey = ref(0)
let bboxChangeFromMap = false

watch(bbox, (newBbox, oldBbox) => {
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
  const activeBbox = draggingBbox.value || bbox.value
  if (activeBbox.valid && (props.displayEditBboxMode || props.showBbox)) {
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
  const initialBbox = bbox.value

  // Build the corners array, order as clockwise:  ne, se, sw, nw
  corners = [
    { point: { lon: initialBbox.ne.lon, lat: initialBbox.ne.lat } },
    { point: { lon: initialBbox.ne.lon, lat: initialBbox.sw.lat } },
    { point: { lon: initialBbox.sw.lon, lat: initialBbox.sw.lat } },
    { point: { lon: initialBbox.sw.lon, lat: initialBbox.ne.lat } }
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
          bbox.value = box
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
    bboxBodyDragStart = null
    bboxBodyCornerStarts = []
  }
})

// --- Bbox body drag: move entire bbox by dragging its interior ---
let bboxBodyDragStart: Point | null = null
let bboxBodyCornerStarts: Point[] = []

function onOverlayDragStart (startPoint: Point) {
  if (corners.length !== 4) { return }
  bboxBodyDragStart = startPoint
  bboxBodyCornerStarts = corners.map(c => ({ lon: c.point.lon, lat: c.point.lat }))
}

function onOverlayDrag (currentPoint: Point) {
  if (!bboxBodyDragStart || bboxBodyCornerStarts.length !== 4) { return }

  const deltaLon = currentPoint.lon - bboxBodyDragStart.lon
  const deltaLat = currentPoint.lat - bboxBodyDragStart.lat

  for (let i = 0; i < 4; i++) {
    corners[i]!.point.lon = bboxBodyCornerStarts[i]!.lon + deltaLon
    corners[i]!.point.lat = bboxBodyCornerStarts[i]!.lat + deltaLat
    corners[i]!.marker?.setLngLat(corners[i]!.point)
  }

  const box = getNormalizedBbox()
  if (box) {
    draggingBbox.value = box
  }
}

function onOverlayDragEnd () {
  const box = getNormalizedBbox()
  bboxBodyDragStart = null
  bboxBodyCornerStarts = []
  draggingBbox.value = null

  if (box) {
    bboxChangeFromMap = true
    bbox.value = box
  }
}

// Lookup for stop features
// This is necessary because the geojson properties are stringified
const stopFeatureLookup = computed(() => {
  const lookup = new Map<string, Stop>()
  for (const feature of props.scenarioFilterResult?.stops || []) {
    lookup.set(feature.id.toString(), toRaw(feature))
  }
  return lookup
})

// Stop clusters. selectedClusterId drives the radius circle + grey-out.
const stopClusters = computed((): StopCluster[] => props.scenarioFilterResult?.stopClusters || [])
const hasClusterData = computed(() => stopClusters.value.length > 0)
const clusterById = computed(() => {
  const m = new Map<string, StopCluster>()
  for (const c of stopClusters.value) {
    m.set(c.id, c)
  }
  return m
})
const selectedClusterId = ref<string | null>(null)
const selectedCluster = computed((): StopCluster | null =>
  selectedClusterId.value ? clusterById.value.get(selectedClusterId.value) ?? null : null)
const selectedMemberSet = computed(() => new Set<number>(selectedCluster.value?.memberStopIds || []))

// Clear the selection if a refetch/refilter drops the selected cluster.
watch(stopClusters, () => {
  if (selectedClusterId.value && !clusterById.value.has(selectedClusterId.value)) {
    selectedClusterId.value = null
  }
})

// Each cluster's anchor stop coordinates — the point its radius circle centers
// on. Marker, spokes, and click target all hub here to stay concentric with it.
const clusterAnchorPoints = computed(() => {
  const m = new Map<string, [number, number]>()
  for (const c of stopClusters.value) {
    const anchor = stopFeatureLookup.value.get(c.anchorStopId.toString())
    if (!anchor) {
      continue
    }
    const lonCoord = anchor.geometry.coordinates[0]
    const latCoord = anchor.geometry.coordinates[1]
    if (lonCoord == null || latCoord == null) {
      continue
    }
    m.set(c.id, [lonCoord, latCoord])
  }
  return m
})

// Invisible click target at each cluster's anchor stop: the visible "beach ball"
// is a DOM overlay, so this circle is what queryRenderedFeatures clicks land on.
const clusterFeatures = computed((): Feature[] => {
  const out: Feature[] = []
  for (const c of stopClusters.value) {
    const anchor = clusterAnchorPoints.value.get(c.id)
    if (!anchor) {
      continue
    }
    out.push({
      type: 'Feature',
      id: c.id,
      geometry: { type: 'Point', coordinates: anchor },
      properties: {
        cluster_id: c.id,
      },
    })
  }
  return out
})

// One "beach ball" marker per cluster (a wedge per agency), a DOM overlay at the
// anchor stop. Wedge colors share agencyColorScale, so they match the stop dots
// in dataDisplayMode === 'Agency'.
const clusterMarkers = computed((): { id: string, point: Point, colors: string[] }[] => {
  const scale = agencyColorScale.value
  const out: { id: string, point: Point, colors: string[] }[] = []
  for (const c of stopClusters.value) {
    const anchor = clusterAnchorPoints.value.get(c.id)
    if (!anchor) {
      continue
    }
    out.push({
      id: c.id,
      point: { lon: anchor[0], lat: anchor[1] },
      colors: c.agencyIds.map(a => scale(String(a))),
    })
  }
  return out
})

// Web Mercator m/px at zoom 0 (512px tiles); sizes the radius circle via native
// circle paint — a rendering primitive, not a client-side geometry op.
const WEB_MERCATOR_Z0_M_PER_PX = 78271.51696
const clusterCircleFeatures = computed((): Feature[] => {
  const c = selectedCluster.value
  if (!c) {
    return []
  }
  const anchor = clusterAnchorPoints.value.get(c.id)
  if (!anchor) {
    return []
  }
  const lat = anchor[1]
  const cosLat = Math.cos((lat * Math.PI) / 180)
  const radiusPxZ0 = cosLat > 0.001 ? c.maxDistanceMeters / (WEB_MERCATOR_Z0_M_PER_PX * cosLat) : 0
  return [{
    type: 'Feature',
    id: `cluster-circle:${c.id}`,
    geometry: { type: 'Point', coordinates: anchor },
    properties: {
      cluster_id: c.id,
      radius_px_z0: radiusPxZ0,
    },
  }]
})

// Connector lines from the anchor stop to each member, while the cluster is
// selected. Straight segments between known points, not a geometry op.
const clusterLineFeatures = computed((): Feature[] => {
  const c = selectedCluster.value
  if (!c) {
    return []
  }
  const anchor = clusterAnchorPoints.value.get(c.id)
  if (!anchor) {
    return []
  }
  const out: Feature[] = []
  for (const memberId of c.memberStopIds) {
    const member = stopFeatureLookup.value.get(memberId.toString())
    if (!member) {
      continue
    }
    out.push({
      type: 'Feature',
      id: `cluster-line:${c.id}:${memberId}`,
      geometry: {
        type: 'LineString',
        coordinates: [anchor, member.geometry.coordinates],
      },
      properties: {
        cluster_id: c.id,
      },
    })
  }
  return out
})

// Calculate top agencies in result set
// (we will order them by the most to least stops)
interface AgencyData {
  id: string // GTFS agency_id — used to match stops/routes
  numericId: number // Transitland numeric agency id — used for color keying + clusters
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
      const anumeric = rstop.route.agency?.id
      const aname = rstop.route.agency?.agency_name
      if (!aid || !aname || anumeric == null) {
        continue // no valid agency listed for this stop?
      }

      let adata = data.get(aid)
      if (!adata) { // first time seeing this agency
        adata = {
          id: aid,
          numericId: anumeric,
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

// Single source of truth for per-agency colors, shared by Agency-mode stop dots
// (getAgencyMatchers) and the cluster beach-ball wedges so an agency renders the
// same color in both. Keyed by the numeric agency id clusters carry.
const agencyColorScale = computed(() =>
  createCategoryColorScale(agencyData.value.map(a => String(a.numericId)), categoricalColors))

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

  // Agencies use the wider 10-color categorical palette (agencyColorScale),
  // not the 6-color route palette.
  function getAgencyMatchers (): Matcher[] {
    const rules: Matcher[] = []
    const agencies = agencyData.value || []
    const scale = agencyColorScale.value
    for (let i = 0; i < Math.min(agencies.length, categoricalColors.length); i++) {
      const agency = agencies[i]
      if (agency) {
        rules.push({ label: agency.name ?? '', color: scale(String(agency.numericId)), match: getAgencyMatcher(agency.id ?? '') })
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
    return rules
  }

  // Reserve an extra color for "other", if needed. Agency mode draws from the
  // wider categorical palette, so its "Other" bucket only kicks in past that.
  const maxColor = colors.length - 1
  const rules: Matcher[] = []

  let otherThreshold = maxColor
  if (dataDisplayMode.value === 'Agency') {
    rules.push(...getAgencyMatchers())
    otherThreshold = categoricalColors.length
  } else if (dataDisplayMode.value === 'Transit mode') {
    rules.push(...getModeMatchers())
  } else if (dataDisplayMode.value === 'Route frequency') {
    rules.push(...getRouteFrequencyMatchers())
  } else if (dataDisplayMode.value === 'Stop visits') {
    rules.push(...getStopVisitMatchers())
  } else if (dataDisplayMode.value === 'Service area') {
    // report-only mode; no map color rules
  }

  // If we used all colors (or no colors), add a catchall "other" rule
  if (rules.length >= otherThreshold || rules.length === 0) {
    rules.push({ label: 'Other', color: '#000', match: _ => true })
  }

  return rules
})

// Selectable geography features for click-to-select in adminBoundary mode.
// Three visual states:
//   1. Current layer, unselected — light gray fill, clickable
//   2. Current layer, selected — red highlight, clickable
//   3. Other layer, selected — light red fill/dashed outline, not clickable
const selectableGeographies = computed((): Feature[] => {
  if (geomSource.value !== 'adminBoundary' || !props.viewportGeographies?.length) {
    return []
  }
  const selectedIds = new Set(geographyIds.value || [])
  const viewportIds = new Set<number>()
  const features: Feature[] = []

  // Current layer: viewport geographies (clickable)
  for (const geo of props.viewportGeographies || []) {
    viewportIds.add(geo.id)
    const isSelected = selectedIds.has(geo.id)
    const stateDesc = geo.adm1_name ? `, ${geo.adm1_name}` : ''
    features.push({
      type: 'Feature',
      id: geo.id.toString(),
      geometry: geo.geometry,
      properties: {
        'geography-id': geo.id,
        'geography-name': `${geo.name}${stateDesc}`,
        'selected': isSelected,
        'clickable': true,
        'fill': isSelected ? '#dc3545' : '#cccccc',
        'fill-opacity': isSelected ? 0.45 : 0.2,
        'stroke': isSelected ? '#dc3545' : '#666666',
        'stroke-width': isSelected ? 2.5 : 1,
        'stroke-opacity': isSelected ? 0.9 : 0.6,
      }
    } as Feature)
  }

  // Other layers: selected geographies not in the current viewport layer
  for (const geo of props.censusGeographiesSelected || []) {
    if (viewportIds.has(geo.id)) {
      continue
    }
    // Only show if it's from a different layer than the current one
    if (geo.layer?.name === geomLayer.value) {
      continue
    }
    const stateDesc = geo.adm1_name ? `, ${geo.adm1_name}` : ''
    const layerDesc = geo.layer?.description || geo.layer?.name || ''
    features.push({
      type: 'Feature',
      id: geo.id.toString(),
      geometry: geo.geometry,
      properties: {
        'geography-id': geo.id,
        'geography-name': `${geo.name}${stateDesc} (${layerDesc})`,
        'selected': true,
        'clickable': false,
        'fill': '#e88e96',
        'fill-opacity': 0.25,
        'stroke': '#e88e96',
        'stroke-width': 1.5,
        'stroke-opacity': 0.6,
      }
    } as Feature)
  }

  return features
})

// Set of geography IDs that are clickable (current layer only)
const clickableGeoIds = computed(() => {
  const ids = new Set<number>()
  for (const f of selectableGeographies.value) {
    if (f.properties?.clickable) {
      ids.add(f.properties['geography-id'])
    }
  }
  return ids
})

// Left-click toggles selection — only for clickable (current layer) features
function onSelectableGeoClick (featureId: string) {
  const geoId = Number.parseInt(featureId)
  if (Number.isNaN(geoId)) {
    return
  }
  if (clickableGeoIds.value.has(geoId)) {
    emit('toggleGeography', geoId)
  }
}

// Right-click also deselects — works for any layer (lets users remove cross-layer selections)
function onSelectableGeoRightClick (featureId: string) {
  const geoId = Number.parseInt(featureId)
  if (Number.isNaN(geoId)) {
    return
  }
  const ids = geographyIds.value || []
  if (ids.includes(geoId)) {
    emit('toggleGeography', geoId)
  }
}

// Features to fit map to when fitOverlayKey is triggered (button or initial load).
// Uses censusGeographiesSelected which is always populated for selected geography IDs.
const fitTargetFeatures = computed((): Feature[] => {
  return props.censusGeographiesSelected.map(geo => ({
    type: 'Feature',
    id: geo.id.toString(),
    geometry: geo.geometry,
    properties: {}
  } as Feature))
})

// Features for display include the all route and stop features.
// Match all features to styling rules and apply as GeoJSON simplestyle
const overlayFeatures = computed((): Feature[] => {
  const forDisplay: Feature[] = []
  const hasGeographies = props.censusGeographiesSelected.length > 0

  // When in adminBoundary mode, the selectable geography layer handles
  // rendering boundaries with selected/unselected styling. Skip adding
  // them to the overlay layer to avoid triggering fitBounds on every
  // click or viewport change.
  // Only suppress overlay features when the selectable geography layer is active
  // (pre-query with viewport geos loaded). Post-query, let overlay features show normally.
  const inAdminBoundaryMode = geomSource.value === 'adminBoundary' && (props.viewportGeographies?.length ?? 0) > 0

  // Show admin geographies OR bbox, never both (mirrors server-side priority)
  if (hasGeographies && !inAdminBoundaryMode) {
    if (props.showBbox) {
      for (const feature of props.censusGeographiesSelected) {
        forDisplay.push({
          type: 'Feature',
          id: feature.id.toString(),
          geometry: feature.geometry,
          properties: {}
        })
      }
    }
  } else if (!hasGeographies && !inAdminBoundaryMode) {
    for (const feature of bboxArea.value) {
      forDisplay.push(toRaw(feature))
    }
  }
  return forDisplay
})

const displayFeatures = computed((): Feature[] => {
  // Return empty array if fixed-route transit is disabled
  // (allows user to focus on flex services only)
  if (fixedRouteEnabled.value === false) {
    return []
  }

  const bgColor = '#aaa'
  const bgOpacity = 0.1
  const styleRules = styleData.value || []
  const forDisplay: Feature[] = []

  // Gather routes
  for (const rp of props.scenarioFilterResult?.routes || []) {
    if (hideUnmarked.value && !rp.marked) {
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

  // A selected cluster focuses the map: show only its member stops.
  const memberSet = selectedMemberSet.value
  const clusterActive = memberSet.size > 0

  // Gather stops
  for (const sp of props.scenarioFilterResult?.stops || []) {
    if (clusterActive) {
      // focused on a cluster: show only its members, regardless of marked state
      if (!memberSet.has(sp.id)) {
        continue
      }
    } else if (hideUnmarked.value && !sp.marked) {
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

// Features for export: the marked features from the layers currently
// displayed on the map (fixedRouteEnabled / flexServicesEnabled), with the
// csv column data merged in.
const exportFeatures = computed((): Feature[] => {
  const bgColor = '#aaa'
  const bgOpacity = 0.4
  const styleRules = styleData.value || []
  const forExport: Feature[] = []
  const routeBufferGeographies = props.scenarioFilterResult?.routeBufferGeographies
  const stopBufferGeographies = props.scenarioFilterResult?.stopBufferGeographies

  if (fixedRouteEnabled.value !== false) {
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
      Object.assign(feature.properties, routeToRouteCsv(rp, routeBufferGeographies?.get(rp.id)))
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
      Object.assign(feature.properties, stopToStopCsv(sp, stopBufferGeographies?.get(sp.id)))
      forExport.push(feature)
    }
  }

  // Flex areas: marked only — flexDisplayFeatures includes unmarked (dashed)
  // areas when hideUnmarked is off. buildFlexAreaProperties carries the csv fields.
  if (flexServicesEnabled.value) {
    for (const f of props.flexDisplayFeatures || []) {
      if (f.properties?.marked) {
        forExport.push(f)
      }
    }
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
  if (!flexServicesEnabled.value) { return [] }
  return props.flexDisplayFeatures || []
})

// Is there fixed-route data to display?
const hasData = computed((): boolean => {
  if (fixedRouteEnabled.value === false) {
    return false
  }
  return !!(props.scenarioFilterResult?.stops.length || props.scenarioFilterResult?.routes.length)
})

// Does flex have data to display?
const hasFlexData = computed((): boolean => {
  return !!(flexServicesEnabled.value && props.flexDisplayFeatures?.length)
})

/**
 * Style data for flex service areas in the legend
 * - Agency mode: No color swatches (too many agencies, user clicks/hovers for details)
 * - Advance notice mode: Three swatches for booking categories
 */
const flexStyleData = computed(() => {
  if (!flexServicesEnabled.value || !props.flexDisplayFeatures?.length) {
    return []
  }

  const colorBy = flexColorBy.value || 'Agency'

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

const extentBbox = ref(bbox.value)

function mapMove (v: any) {
  const b = v.bbox
  extentBbox.value = {
    valid: true,
    sw: { lon: b[0][0], lat: b[0][1] },
    ne: { lon: b[1][0], lat: b[1][1] }
  }
}

watch(extentBbox, () => {
  bboxChangeFromMap = true
  emit('setMapExtent', extentBbox.value)
})

const popupFeatures = ref<PopupFeature[]>([])

function mapClickFeatures (pt: any, features: Feature[]) {
  const entries: Array<{ popupFeature: PopupFeature, sortKey: [number, number] }> = []
  const seenIds = new Set<string>() // same feature can come from multiple layers
  let clickedClusterId: string | null = null

  console.log(`[MapClick] ${features.length} raw features at point`)

  for (const feature of features) {
    const featureId = feature.id?.toString() || ''

    const ft = feature.geometry.type
    const fp = feature.properties

    // cluster markers are Points with a cluster_id property — properties survive
    // queryRenderedFeatures even on the invisible hit circle.
    if (ft === 'Point' && fp.cluster_id) {
      const clusterId = fp.cluster_id.toString()
      if (seenIds.has(`cluster:${clusterId}`)) {
        continue
      }
      seenIds.add(`cluster:${clusterId}`)
      const cluster = clusterById.value.get(clusterId)
      if (cluster) {
        clickedClusterId = clusterId
        entries.push({ popupFeature: buildClusterPopup(cluster, pt), sortKey: [-1, 0] })
      }
      continue
    }

    // Only dedupe if we have a valid ID (skip deduplication for empty IDs)
    if (featureId && seenIds.has(featureId)) {
      continue // Skip duplicate
    }
    if (featureId) {
      seenIds.add(featureId)
    }

    let popupFeature: PopupFeature | undefined = undefined
    let sortKey: [number, number] = [0, 0]

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
      sortKey = [0, 0]
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
      sortKey = [1, 0]
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
      // Matched flex areas (marked=true) sort before unmatched; within each group sort smallest first.
      // Use POSITIVE_INFINITY for missing area so unknown-size areas sort last within their group.
      const matchOrder = fp.marked ? 2 : 3
      sortKey = [matchOrder, fp.area_m2 ?? Number.POSITIVE_INFINITY]
    } else if ((ft === 'Polygon' || ft === 'MultiPolygon') && fp.geoid) {
      // Aggregation-area click: skip the popup, surface the row via event.
      emit('selectAggregation', { ...fp })
      continue
    }

    if (popupFeature) {
      console.log(`[MapClick] Adding popup feature: featureId=${popupFeature.featureId}, sourceLayer=${popupFeature.sourceLayer}`)
      entries.push({ popupFeature, sortKey })
    }
  }

  // clicking a cluster marker selects it; any other click collapses the
  // selection. Not gated on features.length, so passive overlays under the
  // pointer (e.g. choropleth fill) can't block the collapse.
  if (clickedClusterId) {
    selectedClusterId.value = clickedClusterId
  } else {
    selectedClusterId.value = null
  }

  // Sort: cluster (-1) → stops (0) → routes (1) → matched flex by area (2,asc) → unmatched flex by area (3,asc)
  entries.sort((x, y) => x.sortKey[0] - y.sortKey[0] || x.sortKey[1] - y.sortKey[1])

  const a = entries.map(e => e.popupFeature)
  console.log(`[MapClick] ${a.length} unique features after processing`)
  popupFeatures.value = a
}

// Build the "Stop Cluster" popup. Member agency/route detail is derived client-
// side from loaded route_stops — it's not on the lean cluster wire format.
function buildClusterPopup (cluster: StopCluster, pt: any): PopupFeature {
  const members: ClusterMemberInfo[] = []
  const allAgencies = new Set<string>()
  for (const sid of cluster.memberStopIds) {
    const stop = stopFeatureLookup.value.get(sid.toString())
    if (!stop) {
      continue
    }
    const agencies = new Set<string>()
    const routes = new Set<string>()
    for (const rs of stop.route_stops || []) {
      const an = rs.route.agency?.agency_name
      if (an) {
        agencies.add(an)
        allAgencies.add(an)
      }
      const rn = rs.route.route_short_name || rs.route.route_long_name
      if (rn) {
        routes.add(rn)
      }
    }
    members.push({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      agency_names: [...agencies],
      route_names: [...routes],
    })
  }
  return {
    point: { lon: pt.lng, lat: pt.lat },
    featureId: cluster.id,
    sourceLayer: 'clusters',
    featureType: 'cluster',
    data: {
      cluster_id: cluster.id,
      agency_names: [...allAgencies],
      cluster_members: members,
    },
  }
}

function handleOpenTimetable (featureId: string | number) {
  const route = props.scenarioFilterResult?.routes?.find(r => r.id.toString() === featureId.toString())
  if (route) {
    emit('openTimetable', route)
  }
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

// Right-side stack hosting the legend and any slotted panels (census etc.).
.cal-map-sidebar {
  position: absolute;
  right: 50px;
  bottom: 30px;
  width: 400px;
  max-height: calc(100% - 60px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
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
