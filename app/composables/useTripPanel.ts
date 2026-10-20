// Trip information panel state (#476): the map feature it describes, that
// feature's trips within the scenario's filters as table rows, and the fetch
// of each trip's headsign, span, and stop count as the rows are shown.
//
// Called from tne.vue, which passes the results to <cal-trip-panel> and the
// full trip table as props.

import { computed, ref, shallowRef, toValue, triggerRef, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
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
import { dateToSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
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

export function useTripPanel (deps: UseTripPanelDeps): UseTripPanelReturn {
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

  const trips = computed(() => {
    const r = result.value
    const s = resolvedSubject.value
    if (!r || !s) {
      return undefined
    }
    const start = toValue(deps.startTime)
    const end = toValue(deps.endTime)
    return subjectTrips(s, {
      dates: scopedDateRange.value,
      startTime: start ? (dateToSeconds(start) ?? 0) : 0,
      endTime: end ? (dateToSeconds(end) ?? 86400) : 86400,
      stopDepartureCache: r.stopDepartureCache,
      // The filter's own index, so the panel counts what the Routes report
      // counts; built here only for a result made without one.
      routeIndex: s.kind === 'route' ? (r.routeIndex ?? RouteDepartureIndex.fromCache(r.stopDepartureCache)) : undefined,
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
      const cluster = result.value?.stopClusters?.find(c => c.id === s.clusterId)
      const name = cluster?.name ?? stopName(cluster?.anchorStopId ?? s.stopIds[0] ?? 0)
      return `Stop cluster at ${clusterDisplayName(name, cluster?.nearName)}`
    }
    const r = routes.value.get(s.routeId)
    return r ? [r.route_short_name, r.route_long_name].filter(Boolean).join(' ') : 'Route'
  })

  // Trip ids are database ids, unique across feed versions, and a trip's
  // details do not depend on the date, so fetched details stay good for
  // every subject. One map, updated in place as chunks arrive.
  const tripDetails = shallowRef(new Map<number, TripDetail>())
  const inFlight = ref(0)
  const detailsLoading = computed(() => inFlight.value > 0)
  const detailsError = ref<string | null>(null)
  // Asked for already, arrived or in flight, found or not: a trip the API no
  // longer has is not asked for again, and two callers never ask twice.
  const requested = new Set<number>()

  const rows = computed(() => tripTableRows(trips.value?.rows || [], {
    routes: routes.value,
    stops: stops.value,
    tripDetails: tripDetails.value,
    scopedDates: scopedDateRange.value.map(d => format(d, 'yyyy-MM-dd')),
  }))

  const { resolveClient } = useApolloClient()

  async function fetchChunk (ids: number[]): Promise<void> {
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
        tripDetails.value.set(d.id, d)
      }
      scheduleRefresh()
    } catch (err: any) {
      // Let a retry ask again for what did not arrive.
      for (const id of ids) {
        if (!tripDetails.value.has(id)) {
          requested.delete(id)
        }
      }
      detailsError.value = err?.message || String(err)
    } finally {
      inFlight.value--
    }
  }

  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  function scheduleRefresh () {
    refreshTimer ??= setTimeout(refreshNow, DETAILS_REFRESH_MS)
  }
  function refreshNow () {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    triggerRef(tripDetails)
  }

  function clearDetails () {
    clearTimeout(refreshTimer)
    refreshTimer = undefined
    requested.clear()
    tripDetails.value = new Map()
    detailsError.value = null
  }

  async function loadDetails (scope: 'preview' | 'all'): Promise<void> {
    // Rows are in time order, so the first chunk's trips cover the preview.
    let ids = [...new Set((trips.value?.rows || []).map(r => r.tripId))]
    if (scope === 'preview') {
      ids = ids.slice(0, TRIP_DETAILS_CHUNK_SIZE)
    }
    const missing = ids.filter(id => !requested.has(id))
    if (missing.length === 0) {
      return
    }
    detailsError.value = null
    const chunks: number[][] = []
    for (let i = 0; i < missing.length; i += TRIP_DETAILS_CHUNK_SIZE) {
      chunks.push(missing.slice(i, i + TRIP_DETAILS_CHUNK_SIZE))
    }
    for (const id of missing) {
      requested.add(id)
    }
    // A few requests at a time, each worker taking the next chunk.
    const workers = Array.from({ length: Math.min(DETAILS_CONCURRENCY, chunks.length) }, async () => {
      for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
        await fetchChunk(chunk)
      }
    })
    await Promise.all(workers)
    refreshNow()
  }

  return {
    subject,
    resolvedSubject,
    open,
    close,
    trips,
    rows,
    routes,
    title,
    detailsLoading,
    detailsError,
    loadDetails,
    clearDetails,
  }
}
