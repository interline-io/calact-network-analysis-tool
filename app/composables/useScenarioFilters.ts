import { computed, type WritableComputedRef } from 'vue'
import {
  asTimeString,
  parseTime,
  type RouteType,
  type Weekday,
  type WeekdayMode,
} from '~~/src/core'

interface ScenarioFilters {
  startTime: WritableComputedRef<Date | undefined>
  endTime: WritableComputedRef<Date | undefined>
  selectedWeekdayMode: WritableComputedRef<WeekdayMode | undefined>
  selectedRouteTypes: WritableComputedRef<RouteType[] | undefined>
  selectedWeekdays: WritableComputedRef<Weekday[] | undefined>
  selectedAgencies: WritableComputedRef<string[] | undefined>
  frequencyUnder: WritableComputedRef<number | undefined>
  frequencyOver: WritableComputedRef<number | undefined>
  calculateFrequencyMode: WritableComputedRef<boolean | undefined>
  maxFareEnabled: WritableComputedRef<boolean | undefined>
  maxFare: WritableComputedRef<number | undefined>
  minFareEnabled: WritableComputedRef<boolean | undefined>
  minFare: WritableComputedRef<number | undefined>
  flexServicesEnabled: WritableComputedRef<boolean | undefined>
  flexAdvanceNotice: WritableComputedRef<string[] | undefined>
  flexAreaTypesSelected: WritableComputedRef<string[] | undefined>
  flexColorBy: WritableComputedRef<string | undefined>
  // Updates startTime + endTime in a single navigation so neither overwrites the other.
  setTimeRange: (start: Date | undefined, end: Date | undefined) => void
}

// URL-backed post-fetch filters. Consumers (cal-filter, scenarioFilter
// computed in tne.vue) call this directly instead of plumbing v-models.
export function useScenarioFilters (): ScenarioFilters {
  const route = useRoute()

  function setQuery (params: Record<string, any>) {
    const merged: Record<string, any> = {}
    const source = { ...route.query, ...params }
    for (const k in source) {
      if (source[k] !== null && source[k] !== undefined) { merged[k] = source[k] }
    }
    return navigateTo({ replace: true, query: merged })
  }

  function arrayParamOrUndefined (p: string): string[] | undefined {
    if (!Object.prototype.hasOwnProperty.call(route.query, p)) {
      return undefined // Not set - no filter applied.
    }
    const param = route.query[p]
    if (!param) {
      return [] // Explicitly empty - all unchecked.
    }
    return param.toString().split(',').filter(Boolean)
  }

  function setArrayParam (key: string, v: string[] | undefined) {
    if (v === undefined) {
      setQuery({ [key]: undefined })
    } else if (v.length === 0) {
      setQuery({ [key]: '' })
    } else {
      setQuery({ [key]: v.join(',') })
    }
  }

  const startTime = computed<Date | undefined>({
    get: () => parseTime(route.query.startTime?.toString()),
    set: (v) => { setQuery({ startTime: asTimeString(v) }) }
  })

  const endTime = computed<Date | undefined>({
    get: () => parseTime(route.query.endTime?.toString()),
    set: (v) => { setQuery({ endTime: asTimeString(v) }) }
  })

  const selectedWeekdayMode = computed<WeekdayMode | undefined>({
    get: () => (route.query.selectedWeekdayMode?.toString() || 'Any') as WeekdayMode,
    set: (v) => { setQuery({ selectedWeekdayMode: v === 'Any' ? '' : v }) }
  })

  const selectedRouteTypes = computed<RouteType[] | undefined>({
    get: () => {
      const d = arrayParamOrUndefined('selectedRouteTypes')
      return d ? d.map(s => Number.parseInt(s)) : undefined
    },
    set: (v) => { setQuery({ selectedRouteTypes: v ? v.join(',') : undefined }) }
  })

  const selectedAgencies = computed<string[] | undefined>({
    get: () => arrayParamOrUndefined('selectedAgencies'),
    set: (v) => { setQuery({ selectedAgencies: v ? v.join(',') : undefined }) }
  })

  const selectedWeekdays = computed<Weekday[] | undefined>({
    get: () => arrayParamOrUndefined('selectedWeekdays') as Weekday[] | undefined,
    set: (v) => { setQuery({ selectedWeekdays: v ? v.join(',') : undefined }) }
  })

  const frequencyUnder = computed<number | undefined>({
    get: () => {
      const val = route.query.frequencyUnder?.toString()
      return val ? Number.parseInt(val) : undefined
    },
    set: (v) => { setQuery({ frequencyUnder: v != null ? v.toString() : undefined }) }
  })

  const frequencyOver = computed<number | undefined>({
    get: () => {
      const val = route.query.frequencyOver?.toString()
      return val ? Number.parseInt(val) : undefined
    },
    set: (v) => { setQuery({ frequencyOver: v != null ? v.toString() : undefined }) }
  })

  const calculateFrequencyMode = computed<boolean | undefined>({
    get: () => route.query.calculateFrequencyMode?.toString() === 'true',
    set: (v) => { setQuery({ calculateFrequencyMode: v ? 'true' : '' }) }
  })

  const maxFareEnabled = computed<boolean | undefined>({
    get: () => route.query.maxFareEnabled?.toString() === 'true',
    set: (v) => { setQuery({ maxFareEnabled: v ? 'true' : '' }) }
  })

  const maxFare = computed<number | undefined>({
    get: () => Number.parseInt(route.query.maxFare?.toString() || '') || 0,
    set: (v) => { setQuery({ maxFare: (v || '').toString() }) }
  })

  const minFareEnabled = computed<boolean | undefined>({
    get: () => route.query.minFareEnabled?.toString() === 'true',
    set: (v) => { setQuery({ minFareEnabled: v ? 'true' : '' }) }
  })

  const minFare = computed<number | undefined>({
    get: () => Number.parseInt(route.query.minFare?.toString() || '') || 0,
    set: (v) => { setQuery({ minFare: (v || '').toString() }) }
  })

  const flexServicesEnabled = computed<boolean | undefined>({
    get: () => {
      // Default off when fetching fixed-route, on when only flex is fetched.
      const param = route.query.flexServicesEnabled?.toString()
      if (param === 'true') { return true }
      if (param === 'false') { return false }
      return route.query.includeFixedRoute?.toString() === 'false'
    },
    set: (v) => { setQuery({ flexServicesEnabled: v ? 'true' : 'false' }) }
  })

  const flexAdvanceNotice = computed<string[] | undefined>({
    get: () => arrayParamOrUndefined('flexAdvanceNotice'),
    set: (v) => { setArrayParam('flexAdvanceNotice', v) }
  })

  const flexAreaTypesSelected = computed<string[] | undefined>({
    get: () => arrayParamOrUndefined('flexAreaTypesSelected'),
    set: (v) => { setArrayParam('flexAreaTypesSelected', v) }
  })

  const flexColorBy = computed<string | undefined>({
    get: () => route.query.flexColorBy?.toString() || 'Agency',
    set: (v) => { setQuery({ flexColorBy: v === 'Agency' ? '' : v }) }
  })

  function setTimeRange (start: Date | undefined, end: Date | undefined) {
    setQuery({ startTime: asTimeString(start), endTime: asTimeString(end) })
  }

  return {
    startTime,
    endTime,
    selectedWeekdayMode,
    selectedRouteTypes,
    selectedAgencies,
    selectedWeekdays,
    frequencyUnder,
    frequencyOver,
    calculateFrequencyMode,
    maxFareEnabled,
    maxFare,
    minFareEnabled,
    minFare,
    flexServicesEnabled,
    flexAdvanceNotice,
    flexAreaTypesSelected,
    flexColorBy,
    setTimeRange,
  }
}
