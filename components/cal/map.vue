<template>
  <div class="cal-map-outer">
    <div class="cal-map-share-button">
      <o-button icon-left="share" @click="toggleShareMenu()">
        {{ showShareMenu ? 'Close' : 'Share' }}
      </o-button>
    </div>

    <article v-if="showShareMenu" class="cal-map-share message is-dark">
      <div class="message-header">
        Share
      </div>
      <div class="message-body">
        <tl-geojson-downloader :features="displayFeatures" label="Download as GeoJSON" filename="export" />
        <br><br>
        <o-button @click="copyUrlToClipboard">
          Copy URL to Clipboard
        </o-button>
      </div>
    </article>

    <cal-legend
      :data-display-mode="dataDisplayMode"
      :color-key="colorKey"
      :style-data="styleData"
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
import { useToastNotification } from '#imports'
import { type Stop } from '../stop'
import { type Route } from '../route'

const route = useRoute()

function copyUrlToClipboard () {
  navigator.clipboard.writeText(windowUrl.value)
  useToastNotification().showToast('Copied to clipboard')
}

const emit = defineEmits([
  'setBbox',
  'setMapExtent',
])

const props = defineProps<{
  bbox: Bbox
  stopFeatures: Stop[]
  routeFeatures: Route[]
  dataDisplayMode: string
  colorKey: string
  displayEditBboxMode?: boolean
}>()

const showShareMenu = ref(false)
const toggleShareMenu = useToggle(showShareMenu)

const windowUrl = computed(() => {
  return window.location.href
})

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
      if (!aid || !aname) continue // no valid agency listed for this stop?

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
  const rules: Matcher[] = []

  function getAgencyMatcher (val: string): MatchFunction {
    return (v: Stop | Route) => {
      if (v.__typename === 'Stop') {
        const rstops = v.route_stops || []
        return rstops.length > 0 && rstops[0].route?.agency?.agency_id === val
      } else if (v.__typename === 'Route') {
        return v.agency?.agency_id === val
      }
      return false
    }
  }

  function getModeMatcher (val: string): MatchFunction {
    return (v: Stop | Route) => {
      if (v.__typename === 'Stop') {
        return v.modes === val
      } else if (v.__typename === 'Route') {
        return v.mode === val
      }
      return false
    }
  }

  function getFrequencyMatcher (val: number): MatchFunction {
    return (v: Stop | Route) => {
      const f = +v.average_frequency || 0
      return f >= val
    }
  }

  // Reserve an extra color for "other", if needed
  const maxColor = colors.length - 1
  let valueCount = 0

  // Fares not implemented yet, for now just style Fares as agencies
  if (props.dataDisplayMode === 'Agency' || props.colorKey === 'Fares') {
    const agencies = agencyData.value || []
    valueCount = agencies.length
    for (let i = 0; i < Math.min(valueCount, maxColor); i++) {
      const agency = agencies[i]
      const color = colors[i]
      rules.push({ label: agency.name, color: color, match: getAgencyMatcher(agency.id) })
    }
  } else if (props.colorKey === 'Mode') {
    const modes = [...routeTypes.values()]
    valueCount = modes.length
    for (let i = 0; i < Math.min(valueCount, maxColor); i++) {
      const mode = modes[i]
      const color = colors[i]
      rules.push({ label: mode, color: color, match: getModeMatcher(mode) })
    }
  } else if (props.colorKey === 'Frequency') {
    valueCount = 5
    rules.push({ label: '40+', color: colors[0], match: getFrequencyMatcher(40) })
    rules.push({ label: '30-39', color: colors[1], match: getFrequencyMatcher(30) })
    rules.push({ label: '20-29', color: colors[2], match: getFrequencyMatcher(20) })
    rules.push({ label: '10-19', color: colors[3], match: getFrequencyMatcher(10) })
    rules.push({ label: '0-9', color: colors[4], match: getFrequencyMatcher(0) })
  }

  // If we used all colors (or no colors), add a catchall "other" rule
  if (valueCount > maxColor || valueCount === 0) {
    rules.push({ label: 'Other', color: '#000', match: v => true })
  }

  return rules
})

// Merge features, applying the styleData as GeoJSON simplestyle
const displayFeatures = computed(() => {
  const bgColor = '#aaa'
  const bgOpacity = 0.4
  const features: Feature[] = []
  const s = styleData.value || []

  for (const feature of bboxArea.value) {
    features.push(toRaw(feature))
  }

  const renderRoutes: Feature[] = props.routeFeatures.map((rp) => {
    const style = s.find(rule => rule.match(rp))
    return {
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
  })

  const renderStops: Feature[] = props.stopFeatures.map((sp) => {
    const style = s.find(rule => rule.match(sp))
    return {
      type: 'Feature',
      id: sp.id.toString(),
      geometry: sp.geometry,
      properties: {
        'marker-radius': sp.marked ? 8 : 4,
        'marker-color': style?.color || bgColor,
        'marker-opacity': sp.marked ? 1 : bgOpacity,
        'marked': sp.marked,
      },
    }
  })

  // Add unmarked routes, then unmarked stops, then marked routes, then marked stops
  features.push(...renderRoutes.filter(r => !r.properties.marked))
  features.push(...renderStops.filter(r => !r.properties.marked))
  features.push(...renderRoutes.filter(r => r.properties.marked))
  features.push(...renderStops.filter(r => r.properties.marked))
  return features
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
  z-index:100;
}
.cal-map-share {
  position:absolute;
  right:50px;
  top:50px;
  width:300px;
  color:black;
  padding:5px;
  height:150px;
  z-index:100;
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
