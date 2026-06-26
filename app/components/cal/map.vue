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
import { ref, computed, toRaw, watch, toRef } from 'vue'
import { useToggle } from '@vueuse/core'
import { type CensusGeography, type Stop, stopToStopCsv, type Route, routeToRouteCsv } from '~~/src/tl'
import type { Bbox, Feature, Point, PopupFeature, ChoroplethClassification, ClusterMemberInfo } from '~~/src/core'
import { categoricalColors, routeTypeNames, flexColors, createCategoryColorScale } from '~~/src/core'
import { buildStyleData, type Matcher, type ScenarioFilterResult, type StopCluster } from '~~/src/scenario'

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

// Persist a user-drawn bbox, flagged map-originated so the external-change
// watch above won't refit.
function commitBbox (box: Bbox) {
  bboxChangeFromMap = true
  bbox.value = box
}

// Interactive bbox editor: draggable corner markers, body-drag, and the drawn polygon.
const { bboxArea, bboxMarkers, onOverlayDragStart, onOverlayDrag, onOverlayDragEnd } = useBboxEditor({
  bbox,
  displayEditBboxMode: toRef(props, 'displayEditBboxMode'),
  showBbox: toRef(props, 'showBbox'),
  commitBbox,
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

// Matcher rules color stops/routes by the active data-display mode. The pure
// builder (and the Matcher type) live in src/scenario/map-style.ts.
const styleData = computed((): Matcher[] => buildStyleData({
  scenarioFilterResult: props.scenarioFilterResult,
  dataDisplayMode: dataDisplayMode.value,
  agencies: agencyData.value,
  agencyColorScale: agencyColorScale.value,
}))

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
        'marked': rp.marked,
        'average_frequency': rp.average_frequency ?? null,
        'frequency_irregular': rp.frequency_irregular ?? false,
        'frequency_directions_differ': rp.frequency_directions_differ ?? false
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

    // Dedupe by a stable key. MapLibre coerces non-numeric GeoJSON string ids to
    // NaN in queryRenderedFeatures, so flex polygons all report the same id and
    // every overlapping zone but the first would be dropped (#421); key flex on
    // its feed+location id instead. Other layers keep feature.id. Empty keys skip
    // dedupe.
    const isFlexPolygon = (ft === 'Polygon' || ft === 'MultiPolygon') && fp.location_id
    const dedupeKey = isFlexPolygon ? `flex:${fp.feed_onestop_id}:${fp.location_id}` : featureId
    if (dedupeKey && seenIds.has(dedupeKey)) {
      continue // Skip duplicate
    }
    if (dedupeKey) {
      seenIds.add(dedupeKey)
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
          average_frequency: fp.average_frequency ?? undefined,
          frequency_irregular: fp.frequency_irregular,
          frequency_directions_differ: fp.frequency_directions_differ,
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
