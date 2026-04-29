import { addDays, endOfYesterday, nextMonday } from 'date-fns'
import { computed, type WritableComputedRef } from 'vue'
import {
  asDateString,
  bboxString,
  cannedBboxes,
  normalizeDate,
  parseBbox,
  parseDate,
  SCENARIO_DEFAULTS,
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
  fixedRouteEnabled: WritableComputedRef<boolean | undefined>
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
    // endOfYesterday() so that if today is Monday, nextMonday returns today (not next week).
    // normalizeDate strips the time component so the date serializes consistently across timezones.
    get: () => parseDate(route.query.startDate?.toString()) || normalizeDate(nextMonday(endOfYesterday()))!,
    set: (v) => { setQuery({ startDate: asDateString(v) }) }
  })

  const endDate = computed<Date>({
    get: () => parseDate(route.query.endDate?.toString()) || addDays(startDate.value, 6),
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

  // Display toggle that filters fixed-route features out of the map; on by default.
  const fixedRouteEnabled = computed<boolean | undefined>({
    get: () => route.query.fixedRouteEnabled?.toString() !== 'false',
    set: (v) => { setQuery({ fixedRouteEnabled: v ? undefined : 'false' }) }
  })

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
    fixedRouteEnabled,
  }
}
