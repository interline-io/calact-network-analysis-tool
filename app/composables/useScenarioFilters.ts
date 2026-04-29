import { computed, type WritableComputedRef } from 'vue'
import {
  asTimeString,
  parseTime,
  type RouteType,
  type Weekday,
  type WeekdayMode,
} from '~~/src/core'
import { useUrlQuery } from './useUrlQuery'

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
  maxFare: WritableComputedRef<number>
  minFareEnabled: WritableComputedRef<boolean | undefined>
  minFare: WritableComputedRef<number>
  flexServicesEnabled: WritableComputedRef<boolean | undefined>
  flexAdvanceNotice: WritableComputedRef<string[] | undefined>
  flexAreaTypesSelected: WritableComputedRef<string[] | undefined>
  flexColorBy: WritableComputedRef<string | undefined>
  // Updates startTime + endTime in a single navigation so neither overwrites the other.
  setTimeRange: (start: Date | undefined, end: Date | undefined) => void
}

// URL-backed post-fetch filters.
export function useScenarioFilters (): ScenarioFilters {
  const route = useRoute()
  const { setQuery, getArrayParam, setArrayParam } = useUrlQuery()

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
    set: (v) => { setQuery({ selectedWeekdayMode: v === 'Any' ? undefined : v }) }
  })

  const selectedRouteTypes = computed<RouteType[] | undefined>({
    get: () => getArrayParam('selectedRouteTypes')?.map(s => Number.parseInt(s)),
    set: (v) => { setQuery({ selectedRouteTypes: v ? v.join(',') : undefined }) }
  })

  const selectedAgencies = computed<string[] | undefined>({
    get: () => getArrayParam('selectedAgencies'),
    set: (v) => { setQuery({ selectedAgencies: v ? v.join(',') : undefined }) }
  })

  const selectedWeekdays = computed<Weekday[] | undefined>({
    get: () => getArrayParam('selectedWeekdays') as Weekday[] | undefined,
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
    set: (v) => { setQuery({ calculateFrequencyMode: v ? 'true' : undefined }) }
  })

  const maxFareEnabled = computed<boolean | undefined>({
    get: () => route.query.maxFareEnabled?.toString() === 'true',
    set: (v) => { setQuery({ maxFareEnabled: v ? 'true' : undefined }) }
  })

  const maxFare = computed<number>({
    get: () => Number.parseInt(route.query.maxFare?.toString() || '') || 0,
    set: (v) => { setQuery({ maxFare: v.toString() }) }
  })

  const minFareEnabled = computed<boolean | undefined>({
    get: () => route.query.minFareEnabled?.toString() === 'true',
    set: (v) => { setQuery({ minFareEnabled: v ? 'true' : undefined }) }
  })

  const minFare = computed<number>({
    get: () => Number.parseInt(route.query.minFare?.toString() || '') || 0,
    set: (v) => { setQuery({ minFare: v.toString() }) }
  })

  // Off by default. Independent of includeFixedRoute — both fetch toggles
  // can be off, leaving the map empty until the user enables one.
  const flexServicesEnabled = computed<boolean | undefined>({
    get: () => route.query.flexServicesEnabled?.toString() === 'true',
    set: (v) => { setQuery({ flexServicesEnabled: v ? 'true' : undefined }) }
  })

  const flexAdvanceNotice = computed<string[] | undefined>({
    get: () => getArrayParam('flexAdvanceNotice'),
    set: (v) => { setArrayParam('flexAdvanceNotice', v) }
  })

  const flexAreaTypesSelected = computed<string[] | undefined>({
    get: () => getArrayParam('flexAreaTypesSelected'),
    set: (v) => { setArrayParam('flexAreaTypesSelected', v) }
  })

  const flexColorBy = computed<string | undefined>({
    get: () => route.query.flexColorBy?.toString() || 'Agency',
    set: (v) => { setQuery({ flexColorBy: v === 'Agency' ? undefined : v }) }
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
