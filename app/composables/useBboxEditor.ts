// Interactive bbox editor for the scenario map: the draggable corner markers,
// the body-drag to move the whole box, and the polygon drawn while editing.

import { ref, computed, shallowRef, watch, type Ref, type ComputedRef } from 'vue'
import type { Marker } from 'maplibre-gl'
import type { Bbox, Feature, Point, MarkerFeature, MarkerDragEvent } from '~~/src/core'

interface UseBboxEditorDeps {
  // Bbox being edited.
  bbox: Ref<Bbox>
  // Edit mode (draggable markers) vs. read-only outline.
  displayEditBboxMode: Ref<boolean | undefined>
  showBbox: Ref<boolean | undefined>
  // Persist a user-drawn bbox.
  commitBbox: (box: Bbox) => void
}

export interface UseBboxEditorReturn {
  // Polygon feature(s) for the box outline.
  bboxArea: ComputedRef<Feature[]>
  // Draggable corner markers.
  bboxMarkers: ComputedRef<MarkerFeature[]>
  // Body-drag handlers to move the whole box.
  onOverlayDragStart: (startPoint: Point) => void
  onOverlayDrag: (currentPoint: Point) => void
  onOverlayDragEnd: () => void
}

interface CornerData {
  marker?: Marker
  element: HTMLElement
  iconElement: HTMLElement
  point: Point
}

export function useBboxEditor (deps: UseBboxEditorDeps): UseBboxEditorReturn {
  const { bbox, displayEditBboxMode, showBbox, commitBbox } = deps

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
    if (activeBbox.valid && (displayEditBboxMode.value || showBbox.value)) {
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

    if (!displayEditBboxMode.value) {
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
            commitBbox(box)
          }
        }
      })
    }

    return result
  })

  // Clear marker refs when edit mode is turned off (markers will be removed by drawBboxMarkers)
  watch(displayEditBboxMode, (editing) => {
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
      commitBbox(box)
    }
  }

  return { bboxArea, bboxMarkers, onOverlayDragStart, onOverlayDrag, onOverlayDragEnd }
}
