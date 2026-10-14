import { computed, type WritableComputedRef } from 'vue'
import {
  asTimeString,
  parseTime,
  type RouteType,
  type Weekday,
  type WeekdayMode,
} from '~~/src/core'
import { FARE_CATEGORIES, type FareCategory } from '~~/src/tl'
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
  // total visits at a stop during the filtered period; undefined = filter off
  stopVisitsUnder: WritableComputedRef<number | undefined>
  stopVisitsOver: WritableComputedRef<number | undefined>
  // standard-fare categories to keep (#454); undefined = all, filter off
  selectedFareCategories: WritableComputedRef<FareCategory[] | undefined>
  // dollar thresholds on every standard fare; undefined = filter off
  fareMax: WritableComputedRef<number | undefined>
  fareMin: WritableComputedRef<number | undefined>
  flexServicesEnabled: WritableComputedRef<boolean | undefined>
  flexAdvanceNotice: WritableComputedRef<string[] | undefined>
  flexAreaTypesSelected: WritableComputedRef<string[] | undefined>
  flexColorBy: WritableComputedRef<string | undefined>
  // max transfer time (minutes) for the client-side temporal cluster
  // prune. Effective default 15; 0 means proximity-only (no temporal filter).
  clusterMaxTransferMinutes: WritableComputedRef<number>
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

  // Optional non-negative threshold: absent/empty param = filter off
  // (undefined). Integers by default; fare amounts parse floats to keep cents.
  function numberParam (key: string, parse: (s: string) => number = Number.parseInt): WritableComputedRef<number | undefined> {
    const valid = (n: number) => Number.isFinite(n) && n >= 0
    return computed<number | undefined>({
      get: () => {
        const val = route.query[key]?.toString()
        if (!val) {
          return undefined
        }
        // A malformed or negative param reads as "filter off" rather than an
        // active NaN threshold, which would arm the gates, match nothing, and
        // render "NaN" in the filter tag.
        const n = parse(val)
        return valid(n) ? n : undefined
      },
      set: (v) => {
        const n = v == null ? Number.NaN : Number(v)
        setQuery({ [key]: valid(n) ? n.toString() : undefined })
      }
    })
  }

  const frequencyUnder = numberParam('frequencyUnder')
  const frequencyOver = numberParam('frequencyOver')
  const stopVisitsUnder = numberParam('stopVisitsUnder')
  const stopVisitsOver = numberParam('stopVisitsOver')

  const fareMax = numberParam('fareMax', Number.parseFloat)
  const fareMin = numberParam('fareMin', Number.parseFloat)

  // Same convention as selectedRouteTypes: absent = all categories (no
  // filter), empty = none. Unrecognized values are dropped.
  const selectedFareCategories = computed<FareCategory[] | undefined>({
    get: () => getArrayParam('fareCategories')?.filter((c): c is FareCategory => (FARE_CATEGORIES as readonly string[]).includes(c)),
    set: (v) => { setArrayParam('fareCategories', v) }
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

  // minutes; 0 (the default) disables the prune. The filter panel seeds
  // STOP_CLUSTER_DEFAULT_MAX_TRANSFER_MINUTES when the user turns the filter on.
  const clusterMaxTransferMinutes = computed<number>({
    get: () => {
      const raw = route.query.clusterMaxTransferMinutes?.toString()
      if (raw == null || raw === '') {
        return 0
      }
      const n = Number.parseFloat(raw)
      return Number.isFinite(n) && n >= 0 ? n : 0
    },
    set: (v) => {
      setQuery({ clusterMaxTransferMinutes: v === 0 ? undefined : String(v) })
    }
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
    stopVisitsUnder,
    stopVisitsOver,
    selectedFareCategories,
    fareMax,
    fareMin,
    flexServicesEnabled,
    flexAdvanceNotice,
    flexAreaTypesSelected,
    flexColorBy,
    clusterMaxTransferMinutes,
    setTimeRange,
  }
}
