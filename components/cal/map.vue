<template>
  <div class="cal-map-outer">
    <div class="cal-map-share-button">
      <o-button icon-left="share" @click="toggleShareMenu()">
        {{ showShareMenu ? 'Close' : 'Share' }}
      </o-button>
    </div>

    <div v-if="showShareMenu" class="cal-map-share">
      <cal-map-share
        :export-features="exportFeatures"
        :stop-features="stopFeatures"
        :route-features="routeFeatures"
        :agency-features="agencyFeatures"
        :stop-departure-loading-complete="stopDepartureLoadingComplete"
      />
    </div>

    <cal-legend
      :data-display-mode="dataDisplayMode"
      :color-key="colorKey"
      :style-data="styleData"
      :has-data="hasData"
      :display-edit-bbox-mode="displayEditBboxMode"
    />

    <cal-map-viewer-ts
      map-class="tall"
      :center="centerPoint"
      :zoom="14"
      :features="displayFeatures"
      :markers="bboxMarkers"
      :auto-fit="false"
      :popup-features="popupFeatures"
      @map-move="mapMove"
      @map-click-features="mapClickFeatures"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRaw } from 'vue'
import { useToggle } from '@vueuse/core'
import { type Bbox, type Feature, type PopupFeature, type MarkerFeature } from '../geom'
import { colors, routeTypes } from '../constants'
import { type Stop, type StopCsv, stopToStopCsv } from '../stop'
import { type Route, type RouteCsv, routeToRouteCsv } from '../route'
import { type Agency } from '../agency'

const route = useRoute()

const emit = defineEmits<{
  setBbox: [value: BBox]
  setMapExtent: [value: BBox]
  setDisplayFeatures: [value: Feature[]]
  setExportFeatures: [value: Feature[]]
}>()

const props = defineProps<{
  bbox: Bbox
  stopFeatures: Stop[]
  routeFeatures: Route[]
  agencyFeatures: Agency[]
  dataDisplayMode: string
  colorKey: string
  displayEditBboxMode?: boolean
  hideUnmarked: boolean
  stopDepartureLoadingComplete: boolean
}>()

const showShareMenu = ref(false)
const toggleShareMenu = useToggle(showShareMenu)
const exportFeatures = ref<Feature[]>([])

//////////////////
// Map geometries

// Compute initial center point; do not update
const centerPoint = {
  lon: (props.bbox.sw.lon + props.bbox.ne.lon) / 2,
  lat: (props.bbox.sw.lat + props.bbox.ne.lat) / 2
}

// Polygon for drawing bbox area
const bboxArea = computed(() => {
  const f: Feature[] = []
  if (props.bbox.valid && props.displayEditBboxMode) {
    const p = props.bbox
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

// Markers for bbox corners
const bboxMarkers = computed(() => {
  const ret: MarkerFeature[] = []

  if (!props.displayEditBboxMode) {
    return ret
  }

  // Create SW marker with custom element
  const swElement = document.createElement('div')
  swElement.className = 'custom-marker sw-marker'
  const swIconElement = document.createElement('i')
  swIconElement.className = 'mdi mdi-arrow-bottom-left'
  swElement.appendChild(swIconElement)

  ret.push({
    point: props.bbox.sw,
    color: '#ff0000',
    draggable: true,
    element: swElement,
    onDragEnd: (c: any) => {
      emit('setBbox', {
        ne: props.bbox.ne,
        sw: {
          lon: c.target.getLngLat().lng,
          lat: c.target.getLngLat().lat,
        }
      })
    }
  })

  // Create NE marker with custom element
  const neElement = document.createElement('div')
  neElement.className = 'custom-marker ne-marker'
  const neIconElement = document.createElement('i')
  neIconElement.className = 'mdi mdi-arrow-top-right'
  neElement.appendChild(neIconElement)

  ret.push({
    point: props.bbox.ne,
    color: '#00ff00',
    draggable: true,
    element: neElement,
    onDragEnd: (c: any) => {
      emit('setBbox', {
        sw: props.bbox.sw,
        ne: {
          lon: c.target.getLngLat().lng,
          lat: c.target.getLngLat().lat,
        }
      })
    }
  })
  return ret
})

// Lookup for stop features
// This is necessary because the geojson properties are stringified
const stopFeatureLookup = computed(() => {
  const lookup = new Map<string, Stop>()
  for (const feature of props.stopFeatures) {
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
  for (const stop of props.stopFeatures) {
    const props = stop
    const route_stops = props.route_stops || []

    for (const rstop of route_stops) {
      const rid = rstop.route.route_id
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

type MatchFunction = (x: Stop | Route) => boolean

// Calculate style data first
interface Matcher {
  label: string
  color: string
  match: MatchFunction
}

// Depending on the data display, set up matcher rules to choose a styling.
// Matchers should run in the order that they are added to the rules array.
const styleData = computed((): Matcher[] => {
  const routeLookup = new Map<number, Route>()
  for (const route of props.routeFeatures) {
    routeLookup.set(route.id, route)
  }

  const stopLookup = new Map<number, Stop>()
  for (const stop of props.stopFeatures) {
    stopLookup.set(stop.id, stop)
  }

  const routeStopLookup = new Map<number, number[]>()
  for (const stop of props.stopFeatures) {
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
        return (v as Stop).route_stops.every((rs: any) => rs.route.route_type === val)
      } else if (v.__typename === 'Route') {
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
        const headway = (v as Route).average_frequency
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
      rules.push({ label: agency.name, color: color, match: getAgencyMatcher(agency.id) })
    }
    return rules
  }

  // Generate a set of MODE MATCHERS (static)
  function getModeMatchers (): Matcher[] {
    const rules: Matcher[] = []
    const modes = [...routeTypes.keys()]
    for (let i = 0; i < Math.min(modes.length, maxColor); i++) {
      const mode = modes[i]
      const label = routeTypes.get(mode) || 'Unknown'
      const color = colors[i]
      rules.push({ label: label, color: color, match: getModeMatcher(mode) })
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
    rules.push({ label: 'Unknown', color: '#000', match: x => true })
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
    rules.push({ label: 'Unknown', color: '#000', match: x => true })
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
    rules.push({ label: 'Other', color: '#000', match: v => true })
  }

  return rules
})

// Features for display include the all route and stop features
// Features for export include only the "marked" features and the csv column data
// Match all features to styling rules and apply as GeoJSON simplestyle
const displayFeatures = computed((): Feature[] => {
  const bgColor = '#aaa'
  const bgOpacity = 0.4
  const styleRules = styleData.value || []
  const forDisplay: Feature[] = []
  const forExport: Feature[] = []

  // bbox is for display only
  for (const feature of bboxArea.value) {
    forDisplay.push(toRaw(feature))
  }

  // Gather routes
  for (const rp of props.routeFeatures) {
    if (props.hideUnmarked && !rp.marked) {
      continue // skip both display and export
    }

    const style = styleRules.find(rule => rule.match(rp))
    const displayFeature = {
      type: 'Feature',
      id: rp.id.toString(),
      geometry: rp.geometry,
      properties: {
        'id': rp.id,
        'stroke': style?.color || bgColor,
        'stroke-width': rp.marked ? 3 : 0.75,
        'stroke-opacity': rp.marked ? 1 : bgOpacity,
        'route_id': rp.route_id,
        'route_type': rp.route_type,
        'route_short_name': rp.route_short_name,
        'route_long_name': rp.route_long_name,
        'agency_name': rp.agency?.agency_name,
        'agency_id': rp.agency?.agency_id,
        'marked': rp.marked,
      }
    }
    forDisplay.push(displayFeature)

    if (rp.marked) {
      const exportFeature = structuredClone(displayFeature)
      Object.assign(exportFeature.properties, routeToRouteCsv(rp))
      forExport.push(exportFeature)
    }
  }

  // Gather stops
  for (const sp of props.stopFeatures) {
    if (props.hideUnmarked && !sp.marked) {
      continue // skip both display and export
    }

    const style = styleRules.find(rule => rule.match(sp))
    const displayFeature = {
      type: 'Feature',
      id: sp.id.toString(),
      geometry: sp.geometry,
      properties: {
        'id': sp.id,
        'marker-radius': sp.marked ? 8 : 4,
        'marker-color': style?.color || bgColor,
        'marker-opacity': sp.marked ? 1 : bgOpacity,
        'marked': sp.marked,
      }
    }
    forDisplay.push(displayFeature)

    if (sp.marked) {
      const exportFeature = structuredClone(displayFeature)
      Object.assign(exportFeature.properties, stopToStopCsv(sp))
      forExport.push(exportFeature)
    }
  }

  emit('setDisplayFeatures', forDisplay)
  emit('setExportFeatures', forExport)

  exportFeatures.value = forExport
  return forDisplay
})

// Is there data to display?
const hasData = computed((): boolean => {
  return !!(props.stopFeatures.length || props.routeFeatures.length)
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
  for (const feature of features) {
    const ft = feature.geometry.type

    let text = ''
    if (ft === 'Point') {
      const stopLookup = stopFeatureLookup.value.get(feature.id.toString())
      if (!stopLookup) {
        continue
      }
      const fp = stopLookup
      // FIXME: THIS IS TEMPORARY - THIS IS NOT SAFE
      text = `
        Stop ID: ${fp.stop_id}<br>
        <strong>${fp.stop_name}</strong><br>
        Routes: ${fp.route_stops.map((rs: any) => rs.route.route_short_name).join(', ')}<br>
        Agencies: ${fp.route_stops.map((rs: any) => rs.route.agency.agency_name).join(', ')}`
    } else if (ft === 'LineString' || ft === 'MultiLineString') {
      const rp = feature.properties
      text = `
        Route ID: ${rp.route_id}<br>
        <strong>${rp.route_short_name || ''} ${rp.route_long_name}</strong><br>
        Type: ${routeTypes.get(rp.route_type.toString())}<br>
        Agency: ${rp.agency_name}`
    }

    if (text) {
      a.push({
        point: { lon: pt.lng, lat: pt.lat },
        text: text
      })
    }
  }

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
  z-index:101;
}
.cal-map-share {
  position:absolute;
  right:50px;
  top:50px;
  width:300px;
  color:black;
  padding:5px;
  height:150px;
  z-index:101;
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
