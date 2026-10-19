// Trip information panel state (#476): the map feature it describes, that
// feature's trips within the scenario's filters, and the lazy fetch of each
// trip's headsign, span, and stop count for the Trips tab.
//
// Called from tne.vue, which passes the results to <cal-trip-panel> as props.

import { computed, ref, shallowRef, toValue, type ComputedRef, type MaybeRefOrGetter, type Ref } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import { format } from 'date-fns'
import {
  subjectTrips,
  resolveEffectiveWeekdays,
  type ScenarioFilterResult,
  type SubjectTrips,
  type TripSubject,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { dateToSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
import {
  RouteDepartureIndex,
  TRIP_DETAILS_CHUNK_SIZE,
  parseTripDetails,
  tripDetailsQuery,
  type TripDetail,
  type TripDetailsResponse,
} from '~~/src/tl'

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
  open: (next: TripSubject) => void
  close: () => void
  trips: ComputedRef<SubjectTrips | undefined>
  // The subject by name: a stop's, a route's, or a cluster's anchor stop's.
  title: ComputedRef<string>
  // The scoped dates as yyyy-MM-dd, for naming the days a row runs.
  scopedDates: ComputedRef<string[]>
  tripDetails: Ref<Map<number, TripDetail>>
  detailsLoading: Ref<boolean>
  detailsError: Ref<string | null>
  loadDetails: () => Promise<void>
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

  // Scoped as the reports scope them, so the panel's counts match.
  const scopedDateRange = computed(() => scopeDatesToWeekdays(
    toValue(deps.selectedDateRange),
    resolveEffectiveWeekdays(toValue(deps.selectedWeekdays), toValue(deps.selectedWeekdayMode)),
  ))

  const scopedDates = computed(() => scopedDateRange.value.map(d => format(d, 'yyyy-MM-dd')))

  // Built only for a route, and once per filter result: it walks every
  // departure in the scenario.
  const routeIndex = computed(() => {
    const result = toValue(deps.scenarioFilterResult)
    if (!result || subject.value?.kind !== 'route') {
      return undefined
    }
    return RouteDepartureIndex.fromCache(result.stopDepartureCache)
  })

  const trips = computed(() => {
    const result = toValue(deps.scenarioFilterResult)
    const s = subject.value
    if (!result || !s) {
      return undefined
    }
    const start = toValue(deps.startTime)
    const end = toValue(deps.endTime)
    // A cluster's members follow the max-transfer-time prune as filters
    // change; keep the members it opened with if it drops out entirely.
    let subjectNow = s
    if (s.kind === 'cluster') {
      const cluster = result.stopClusters?.find(c => c.id === s.clusterId)
      if (cluster) {
        subjectNow = { ...s, stopIds: cluster.memberStopIds }
      }
    }
    return subjectTrips(subjectNow, {
      dates: scopedDateRange.value,
      startTime: start ? (dateToSeconds(start) ?? 0) : 0,
      endTime: end ? (dateToSeconds(end) ?? 86400) : 86400,
      stopDepartureCache: result.stopDepartureCache,
      routeIndex: routeIndex.value,
    })
  })

  const title = computed(() => {
    const result = toValue(deps.scenarioFilterResult)
    const s = subject.value
    if (!s) {
      return ''
    }
    const stopName = (id: number) => {
      const stop = result?.stops.find(st => st.id === id)
      return stop?.stop_name || stop?.stop_id || String(id)
    }
    if (s.kind === 'stop') {
      return stopName(s.stopId)
    }
    if (s.kind === 'cluster') {
      const cluster = result?.stopClusters?.find(c => c.id === s.clusterId)
      return `Stop cluster at ${stopName(cluster?.anchorStopId ?? s.stopIds[0] ?? 0)}`
    }
    const r = result?.routes.find(rt => rt.id === s.routeId)
    return r ? [r.route_short_name, r.route_long_name].filter(Boolean).join(' ') : 'Route'
  })

  // Trip ids are database ids, unique across feed versions, and a trip's
  // details do not depend on the date, so fetched details stay good for
  // every subject.
  const tripDetails = shallowRef(new Map<number, TripDetail>())
  const detailsLoading = ref(false)
  const detailsError = ref<string | null>(null)
  // Asked for already, found or not, so a trip the API no longer has is not
  // asked for again.
  const requested = new Set<number>()

  const { resolveClient } = useApolloClient()

  async function loadDetails (): Promise<void> {
    const rows = trips.value?.rows || []
    const missing = [...new Set(rows.map(r => r.tripId))].filter(id => !requested.has(id))
    if (missing.length === 0 || detailsLoading.value) {
      return
    }
    detailsLoading.value = true
    detailsError.value = null
    try {
      for (let i = 0; i < missing.length; i += TRIP_DETAILS_CHUNK_SIZE) {
        const ids = missing.slice(i, i + TRIP_DETAILS_CHUNK_SIZE)
        for (const id of ids) {
          requested.add(id)
        }
        const result = await resolveClient().query<TripDetailsResponse>({
          query: tripDetailsQuery,
          variables: { ids, limit: ids.length },
        })
        // A new map per chunk, so the table fills in as chunks arrive.
        const next = new Map(tripDetails.value)
        for (const d of parseTripDetails(result.data)) {
          next.set(d.id, d)
        }
        tripDetails.value = next
      }
    } catch (err: any) {
      // Let a retry ask again for what did not arrive.
      for (const id of missing) {
        if (!tripDetails.value.has(id)) {
          requested.delete(id)
        }
      }
      detailsError.value = err?.message || String(err)
    } finally {
      detailsLoading.value = false
    }
    // A subject opened while this fetch ran may still be missing details.
    if (!detailsError.value && (trips.value?.rows || []).some(r => !requested.has(r.tripId))) {
      await loadDetails()
    }
  }

  return {
    subject,
    open,
    close,
    trips,
    title,
    scopedDates,
    tripDetails,
    detailsLoading,
    detailsError,
    loadDetails,
  }
}
