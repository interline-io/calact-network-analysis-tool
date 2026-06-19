import { computed, type WritableComputedRef } from 'vue'
import {
  asDateString,
  bboxString,
  cannedBboxes,
  defaultEndDate,
  defaultStartDate,
  parseBbox,
  parseDate,
  SCENARIO_DEFAULTS,
  STOP_BUFFER_DEFAULT_LAYER,
  STOP_BUFFER_DEFAULT_RADIUS,
  type Bbox,
} from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

interface ScenarioInputs {
  bbox: WritableComputedRef<Bbox>
  cannedBbox: WritableComputedRef<string>
  startDate: WritableComputedRef<Date>
  endDate: WritableComputedRef<Date>
  geographyIds: WritableComputedRef<number[]>
  geomSource: WritableComputedRef<string>
  geomLayer: WritableComputedRef<string>
  geoDatasetName: WritableComputedRef<string>
  includeFixedRoute: WritableComputedRef<boolean | undefined>
  includeFlexAreas: WritableComputedRef<boolean | undefined>
  includeDepartures: WritableComputedRef<boolean | undefined>
  includeCensus: WritableComputedRef<boolean | undefined>
  fixedRouteEnabled: WritableComputedRef<boolean | undefined>
  // fvids CSV — see parseFvids/serializeFvids for the encoding.
  fvids: WritableComputedRef<string>
  // #315 — 0 disables the feature.
  stopBufferRadius: WritableComputedRef<number>
  stopBufferLayer: WritableComputedRef<string>
  // #330 stop clustering — distance in meters; 0 disables the feature (drives
  // the stop-clusters fetch phase). The enable checkbox derives from this.
  clusterDistance: WritableComputedRef<number>
  // Atomic commit of the "Dates & feed versions" modal's staged state —
  // setQuery is only race-safe within a single call, so the three params
  // must land in one navigation.
  applyDatesAndFvids: (v: { startDate: Date, endDate: Date, fvids: string }) => void
}

// URL-backed inputs that drive scenario fetching.
export function useScenarioInputs (): ScenarioInputs {
  const route = useRoute()
  const { setQuery, getArrayParam } = useUrlQuery()

  const cannedBbox = computed<string>({
    get: () => route.query.example?.toString() || 'downtown-portland',
    // Clear explicit bbox so the canned bbox value takes effect.
    set: (v) => { setQuery({ example: v || undefined, bbox: undefined }) }
  })

  const bbox = computed<Bbox>({
    get: () => {
      const defaultBbox = cannedBboxes[cannedBbox.value as keyof typeof cannedBboxes]?.bboxString || ''
      return parseBbox(route.query.bbox?.toString() ?? defaultBbox)
    },
    set: (v) => { setQuery({ bbox: bboxString(v) }) }
  })

  const startDate = computed<Date>({
    get: () => parseDate(route.query.startDate?.toString()) || defaultStartDate(),
    set: (v) => { setQuery({ startDate: asDateString(v) }) }
  })

  const endDate = computed<Date>({
    get: () => parseDate(route.query.endDate?.toString()) || defaultEndDate(startDate.value),
    set: (v) => { setQuery({ endDate: asDateString(v) }) }
  })

  const geographyIds = computed<number[]>({
    get: () => getArrayParam('geographyIds')?.map(s => Number.parseInt(s)) || [],
    set: (v) => { setQuery({ geographyIds: v.length > 0 ? v.map(String).join(',') : undefined }) }
  })

  const geomSource = computed<string>({
    get: () => route.query.geomSource?.toString() || 'bbox',
    set: (v) => { setQuery({ geomSource: v }) }
  })

  const geomLayer = computed<string>({
    get: () => route.query.geomLayer?.toString() || 'place',
    set: (v) => { setQuery({ geomLayer: v || undefined }) }
  })

  const geoDatasetName = computed<string>({
    get: () => route.query.geoDatasetName?.toString() || SCENARIO_DEFAULTS.geoDatasetName,
    set: (v) => { setQuery({ geoDatasetName: v === SCENARIO_DEFAULTS.geoDatasetName ? undefined : v }) }
  })

  const includeFixedRoute = computed<boolean | undefined>({
    get: () => route.query.includeFixedRoute?.toString() !== 'false',
    set: (v) => { setQuery({ includeFixedRoute: v ? undefined : 'false' }) }
  })

  const includeFlexAreas = computed<boolean | undefined>({
    get: () => route.query.includeFlexAreas?.toString() !== 'false',
    set: (v) => { setQuery({ includeFlexAreas: v ? undefined : 'false' }) }
  })

  // Departure schedules dominate scenario loading time; off skips them.
  const includeDepartures = computed<boolean | undefined>({
    get: () => route.query.includeDepartures?.toString() !== 'false',
    set: (v) => { setQuery({ includeDepartures: v ? undefined : 'false' }) }
  })

  // Census demographics: aggregation-layer ACS values + stop-buffer passes.
  const includeCensus = computed<boolean | undefined>({
    get: () => route.query.includeCensus?.toString() !== 'false',
    set: (v) => { setQuery({ includeCensus: v ? undefined : 'false' }) }
  })

  // Display toggle that filters fixed-route features out of the map; on by default.
  const fixedRouteEnabled = computed<boolean | undefined>({
    get: () => route.query.fixedRouteEnabled?.toString() !== 'false',
    set: (v) => { setQuery({ fixedRouteEnabled: v ? undefined : 'false' }) }
  })

  const fvids = computed<string>({
    get: () => route.query.fvids?.toString() || '',
    set: (v) => { setQuery({ fvids: v || undefined }) }
  })

  // Omit URL param when at default to keep shared links short.
  const stopBufferRadius = computed<number>({
    get: () => {
      const raw = route.query.stopBufferRadius?.toString()
      if (raw == null || raw === '') {
        return STOP_BUFFER_DEFAULT_RADIUS
      }
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) && n >= 0 ? n : STOP_BUFFER_DEFAULT_RADIUS
    },
    set: (v) => {
      setQuery({ stopBufferRadius: v === STOP_BUFFER_DEFAULT_RADIUS ? undefined : String(v) })
    }
  })

  // Defaults to the aggregation layer (set on the Query page) when not explicitly
  // chosen, so the Filter selector's buffer layer starts out matching it. The setter
  // elides against that same effective default so picking the default keeps tracking
  // aggregateLayer rather than pinning a stale value into the URL.
  const stopBufferLayer = computed<string>({
    get: () => route.query.stopBufferLayer?.toString()
      || route.query.aggregateLayer?.toString()
      || STOP_BUFFER_DEFAULT_LAYER,
    set: (v) => {
      const fallback = route.query.aggregateLayer?.toString() || STOP_BUFFER_DEFAULT_LAYER
      setQuery({ stopBufferLayer: v === fallback ? undefined : v })
    }
  })

  // #330 — meters. 0 (default/elided) disables clustering. Mirrors stopBufferRadius.
  const clusterDistance = computed<number>({
    get: () => {
      const raw = route.query.clusterDistance?.toString()
      if (raw == null || raw === '') {
        return 0
      }
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) && n >= 0 ? n : 0
    },
    set: (v) => {
      setQuery({ clusterDistance: v > 0 ? String(v) : undefined })
    }
  })

  function applyDatesAndFvids (v: { startDate: Date, endDate: Date, fvids: string }) {
    setQuery({
      startDate: asDateString(v.startDate),
      endDate: asDateString(v.endDate),
      fvids: v.fvids || undefined,
    })
  }

  return {
    bbox,
    cannedBbox,
    startDate,
    endDate,
    geographyIds,
    geomSource,
    geomLayer,
    geoDatasetName,
    includeFixedRoute,
    includeFlexAreas,
    includeDepartures,
    includeCensus,
    fixedRouteEnabled,
    fvids,
    stopBufferRadius,
    stopBufferLayer,
    clusterDistance,
    applyDatesAndFvids,
  }
}
