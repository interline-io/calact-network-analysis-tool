// Trip information panel state (#476): the map feature it describes, that
// feature's trips within the scenario's filters as table rows, and the fetch
// of each trip's headsign, span, and stop count as the rows are shown.
//
// Called from tne.vue, which passes the results to <cal-trip-panel> and the
// full trip table as props.

import { computed, ref, shallowRef, toValue, triggerRef, type ComputedRef, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import { format } from 'date-fns'
import {
  clusterDisplayName,
  subjectTrips,
  resolveEffectiveWeekdays,
  tripTableRows,
  type ResolvedTripSubject,
  type ScenarioFilterResult,
  type SubjectTrips,
  type TripSubject,
  type TripTableRow,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { timeWindowSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
import {
  RouteDepartureIndex,
  TRIP_DETAILS_CHUNK_SIZE,
  parseTripDetails,
  routesById,
  tripDetailsQuery,
  type Route,
  type Stop,
  type TripDetail,
  type TripDetailsResponse,
} from '~~/src/tl'

// Detail requests in flight at once, when the full table asks for them all.
const DETAILS_CONCURRENCY = 4

// Rows are rebuilt from arrived details at most this often while chunks land,
// rather than once per chunk.
const DETAILS_REFRESH_MS = 250

export interface UseTripPanelDeps {
  scenarioFilterResult: MaybeRefOrGetter<ScenarioFilterResult | undefined>
  selectedDateRange: MaybeRefOrGetter<Date[]>
  selectedWeekdays: MaybeRefOrGetter<Weekday[] | undefined>
  selectedWeekdayMode: MaybeRefOrGetter<WeekdayMode | undefined>
  startTime: MaybeRefOrGetter<Date | undefined>
  endTime: MaybeRefOrGetter<Date | undefined>
  // A route's trips the reports leave out are listed too, marked with why.
  includeExcluded?: MaybeRefOrGetter<boolean>
}

export interface UseTripPanelReturn {
  subject: Ref<TripSubject | undefined>
  // The subject with a cluster's current members; undefined once the filters
  // drop the cluster.
  resolvedSubject: ComputedRef<ResolvedTripSubject | undefined>
  open: (next: TripSubject) => void
  close: () => void
  trips: ComputedRef<SubjectTrips | undefined>
  // trips.rows as table rows (and CSV records), with whatever trip details
  // have arrived.
  rows: ComputedRef<TripTableRow[]>
  // The rows cover more than one date, so the table says which days each runs.
  multiDay: ComputedRef<boolean>
  routes: ComputedRef<Map<number, Route>>
  // The subject by name: a stop's, a route's, or a cluster's anchor stop's.
  title: ComputedRef<string>
  detailsLoading: ComputedRef<boolean>
  detailsError: Ref<string | null>
  // Fetch details for the rows shown: the first page's trips for the panel's
  // preview, or every trip for the full table.
  loadDetails: (scope: 'preview' | 'all') => Promise<void>
  // Forget fetched details, as when the scenario is cleared.
  clearDetails: () => void
}

/**
 * Fetched trip details, shared by every useTripPanel given it. Trip ids are
 * database ids, unique across feed versions, and a trip's details do not
 * depend on the date, so details fetched for one subject, or one view, stay
 * good for every other.
 */
export interface TripDetailsStore {
  details: ShallowRef<Map<number, TripDetail>>
  loading: ComputedRef<boolean>
  // Fetch details for the trips not yet asked for; resolves with the first
  // error, or null.
  load: (ids: number[]) => Promise<string | null>
  // Forget fetched details, as when the scenario is cleared.
  clear: () => void
}

export function createTripDetailsStore (): TripDetailsStore {
  // One map, updated in place as chunks arrive.
  const details = shallowRef(new Map<number, TripDetail>())
  const inFlight = ref(0)
  // Asked for already, arrived or in flight, found or not: a trip the API no
  // longer has is not asked for again, and two callers never ask twice.
  const requested = new Set<number>()
  const { resolveClient } = useApolloClient()

  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleRefresh () {
    refreshTimer ??= setTimeout(refreshNow, DETAILS_REFRESH_MS)
  }
  function refreshNow () {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    triggerRef(details)
  }

  async function fetchChunk (ids: number[]): Promise<string | null> {
    inFlight.value++
    try {
      // Partial data is still worth showing: a stop the API cannot return
      // nulls only its own stop time, and one error per such stop would
      // otherwise fail the whole chunk. Not cached by Apollo: the parsed
      // details are kept here, and the requested set stops a refetch.
      const response = await resolveClient().query<TripDetailsResponse>({
        query: tripDetailsQuery,
        variables: { ids, limit: ids.length },
        errorPolicy: 'all',
        fetchPolicy: 'no-cache',
      })
      if (!response.data?.trips) {
        throw new Error(response.errors?.[0]?.message || 'No trip details returned')
      }
      if (response.errors?.length) {
        console.warn(`[TripDetails] ${response.errors.length} partial errors`, response.errors[0])
      }
      for (const d of parseTripDetails(response.data)) {
        details.value.set(d.id, d)
      }
      scheduleRefresh()
      return null
    } catch (err: any) {
      // Let a retry ask again for what did not arrive.
      for (const id of ids) {
        if (!details.value.has(id)) {
          requested.delete(id)
        }
      }
      return err?.message || String(err)
    } finally {
      inFlight.value--
    }
  }

  async function load (ids: number[]): Promise<string | null> {
    const missing = ids.filter(id => !requested.has(id))
    if (missing.length === 0) {
      return null
    }
    const chunks: number[][] = []
    for (let i = 0; i < missing.length; i += TRIP_DETAILS_CHUNK_SIZE) {
      chunks.push(missing.slice(i, i + TRIP_DETAILS_CHUNK_SIZE))
    }
    for (const id of missing) {
      requested.add(id)
    }
    // A few requests at a time, each worker taking the next chunk.
    let error: string | null = null
    const workers = Array.from({ length: Math.min(DETAILS_CONCURRENCY, chunks.length) }, async () => {
      for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
        error ??= await fetchChunk(chunk)
      }
    })
    await Promise.all(workers)
    refreshNow()
    return error
  }

  function clear () {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    requested.clear()
    details.value = new Map()
  }

  return { details, loading: computed(() => inFlight.value > 0), load, clear }
}

export function useTripPanel (deps: UseTripPanelDeps, store: TripDetailsStore = createTripDetailsStore()): UseTripPanelReturn {
  const subject = ref<TripSubject | undefined>(undefined)

  function open (next: TripSubject) {
    detailsError.value = null
    subject.value = next
  }

  function close () {
    subject.value = undefined
  }

  const result = computed(() => toValue(deps.scenarioFilterResult))
  const routes = computed(() => routesById(result.value?.routes || []))
  const stops = computed(() => new Map<number, Stop>((result.value?.stops || []).map(s => [s.id, s])))

  // A cluster's members follow the max-transfer-time prune as filters change.
  const resolvedSubject = computed((): ResolvedTripSubject | undefined => {
    const s = subject.value
    if (s?.kind !== 'cluster') {
      return s
    }
    const cluster = result.value?.stopClusters?.find(c => c.id === s.clusterId)
    return cluster ? { ...s, stopIds: cluster.memberStopIds } : undefined
  })

  // Scoped as the reports scope them, so the panel's counts match.
  const scopedDateRange = computed(() => scopeDatesToWeekdays(
    toValue(deps.selectedDateRange),
    resolveEffectiveWeekdays(toValue(deps.selectedWeekdays), toValue(deps.selectedWeekdayMode)),
  ))

  // Only a route lists excluded trips.
  const includeExcluded = computed(() => resolvedSubject.value?.kind === 'route' && !!toValue(deps.includeExcluded))

  const trips = computed(() => {
    const r = result.value
    const s = resolvedSubject.value
    if (!r || !s) {
      return undefined
    }
    // By date string, not Date identity, so a caller's dates need not be the
    // same objects the scoping returned.
    const scoped = new Set(scopedDateRange.value.map(d => format(d, 'yyyy-MM-dd')))
    return subjectTrips(s, {
      dates: scopedDateRange.value,
      ...timeWindowSeconds(toValue(deps.startTime), toValue(deps.endTime)),
      stopDepartureCache: r.stopDepartureCache,
      // The filter's own index, so the panel counts what the Routes report
      // counts; built here only for a result made without one.
      routeIndex: s.kind === 'route' ? (r.routeIndex ?? RouteDepartureIndex.fromCache(r.stopDepartureCache)) : undefined,
      includeExcluded: includeExcluded.value,
      excludedDates: toValue(deps.selectedDateRange).filter(d => !scoped.has(format(d, 'yyyy-MM-dd'))),
    })
  })

  const title = computed(() => {
    const s = resolvedSubject.value
    if (!s) {
      return ''
    }
    const stopName = (id: number) => {
      const stop = stops.value.get(id)
      return stop?.stop_name || stop?.stop_id || String(id)
    }
    if (s.kind === 'stop') {
      return stopName(s.stopId)
    }
    if (s.kind === 'cluster') {
      // resolvedSubject only holds a cluster the filters still have.
      const cluster = result.value?.stopClusters?.find(c => c.id === s.clusterId)
      return cluster ? clusterDisplayName(cluster.name, cluster.nearName) : 'Stop cluster'
    }
    const r = routes.value.get(s.routeId)
    return r ? [r.route_short_name, r.route_long_name].filter(Boolean).join(' ') : 'Route'
  })

  const detailsError = ref<string | null>(null)

  // Excluded trips run on dates outside the scoped ones too.
  const describedDates = computed(() => (includeExcluded.value ? toValue(deps.selectedDateRange) : scopedDateRange.value).map(d => format(d, 'yyyy-MM-dd')))
  const multiDay = computed(() => describedDates.value.length > 1)

  const rows = computed(() => tripTableRows(trips.value?.rows || [], {
    routes: routes.value,
    stops: stops.value,
    tripDetails: store.details.value,
    describedDates: describedDates.value,
    includeExcluded: includeExcluded.value,
  }))

  function clearDetails () {
    store.clear()
    detailsError.value = null
  }

  async function loadDetails (scope: 'preview' | 'all'): Promise<void> {
    // Rows are in time order, so the first chunk's trips cover the preview.
    let ids = [...new Set((trips.value?.rows || []).map(r => r.tripId))]
    if (scope === 'preview') {
      ids = ids.slice(0, TRIP_DETAILS_CHUNK_SIZE)
    }
    // Cleared while the load runs, so a retry does not show the last error.
    detailsError.value = null
    detailsError.value = await store.load(ids)
  }

  return {
    subject,
    resolvedSubject,
    open,
    close,
    trips,
    rows,
    multiDay,
    routes,
    title,
    detailsLoading: store.loading,
    detailsError,
    loadDetails,
    clearDetails,
  }
}
