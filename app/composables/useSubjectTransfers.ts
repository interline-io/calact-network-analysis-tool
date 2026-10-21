// Transfers at a stop or stop cluster: its arrivals paired with the departures
// soon after, graded, as the Reports tab's Transfer Analyst shows them.
//
// Called from tne.vue, which passes the results to <cal-transfer-report> as
// props. Trip details come from the store the trip panel and table share;
// distances between the stops, from the Transitland directions API.

import { computed, ref, shallowRef, toValue, triggerRef, type MaybeRefOrGetter } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import { format } from 'date-fns'
import {
  DEFAULT_TRANSFER_SETTINGS,
  calculateTransfers,
  calendarTime,
  clusterDisplayName,
  filterTransferGroups,
  resolveEffectiveWeekdays,
  summarizeTransfers,
  transferEvents,
  transferGradeCounts,
  transferOverview,
  transferRows,
  transferSummaryRows,
  transferRouteKey,
  transferTripIds,
  validBreakpoints,
  type ScenarioFilterResult,
  type TransferEvent,
  type TransferRouteChoice,
  type TransferSettings,
  type TransferTimeBand,
  type TripSubject,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { dateToSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
import {
  STOP_DISTANCE_BATCH_SIZE,
  parseStopDistances,
  routesById,
  stopDistancesRequest,
  stopPairKey,
  stopPairs,
  type Stop,
  type StopDistanceMode,
  type StopDistancesResponse,
  type StopPoint,
} from '~~/src/tl'
import type { TripDetailsStore } from './useTripPanel'

export interface UseSubjectTransfersDeps {
  // A stop or cluster; a route has no transfers of its own.
  subject: MaybeRefOrGetter<TripSubject | undefined>
  scenarioFilterResult: MaybeRefOrGetter<ScenarioFilterResult | undefined>
  selectedDateRange: MaybeRefOrGetter<Date[]>
  selectedWeekdays: MaybeRefOrGetter<Weekday[] | undefined>
  selectedWeekdayMode: MaybeRefOrGetter<WeekdayMode | undefined>
  startTime: MaybeRefOrGetter<Date | undefined>
  endTime: MaybeRefOrGetter<Date | undefined>
}

export function useSubjectTransfers (deps: UseSubjectTransfersDeps, store: TripDetailsStore) {
  const settings = ref<TransferSettings>({ ...DEFAULT_TRANSFER_SETTINGS })
  // Breakpoints that cannot grade waits are not applied.
  const breakpoints = computed(() => (validBreakpoints(settings.value.breakpoints) ? settings.value.breakpoints : DEFAULT_TRANSFER_SETTINGS.breakpoints))
  // The arrivals shown: on one date (all, when unset, in the Summary), and in
  // one time band.
  const selectedDate = ref<string>()
  const timeBand = ref<TransferTimeBand>('all')

  const result = computed(() => toValue(deps.scenarioFilterResult))
  const routes = computed(() => routesById(result.value?.routes || []))
  const stops = computed(() => new Map<number, Stop>((result.value?.stops || []).map(s => [s.id, s])))
  const cluster = computed(() => {
    const s = toValue(deps.subject)
    return s?.kind === 'cluster' ? result.value?.stopClusters?.find(c => c.id === s.clusterId) : undefined
  })
  // A cluster's members follow the filters, as the trip panel's do.
  const stopIds = computed((): number[] => {
    const s = toValue(deps.subject)
    if (s?.kind === 'stop') {
      return stops.value.has(s.stopId) ? [s.stopId] : []
    }
    return cluster.value?.memberStopIds ?? []
  })
  // Scoped as the reports scope them.
  const dates = computed(() => scopeDatesToWeekdays(
    toValue(deps.selectedDateRange),
    resolveEffectiveWeekdays(toValue(deps.selectedWeekdays), toValue(deps.selectedWeekdayMode)),
  ).map(d => format(d, 'yyyy-MM-dd')))
  const timeWindow = computed(() => {
    const start = toValue(deps.startTime)
    const end = toValue(deps.endTime)
    return {
      startTime: start ? (dateToSeconds(start) ?? 0) : 0,
      endTime: end ? (dateToSeconds(end) ?? 86400) : 86400,
    }
  })

  // Meters between the subject's stops, by stopPairKey, for each source asked
  // for; kept across subjects, as a pair's distance does not change.
  const distances = shallowRef(new Map<StopDistanceMode, Map<string, number>>())
  const distancesRequested = new Set<string>()
  const distancesLoading = ref(0)
  const distancesError = ref<string | null>(null)
  const { resolveClient } = useApolloClient()

  const stopPoints = computed((): StopPoint[] => stopIds.value.flatMap((id) => {
    const [lon, lat] = stops.value.get(id)?.geometry.coordinates ?? []
    return lon !== undefined && lat !== undefined ? [{ id, lon, lat }] : []
  }))
  // The sources the walk reads: a straight line always, as the street
  // network's fallback where it cannot route a pair.
  const distanceModes = computed((): StopDistanceMode[] => (settings.value.walkDistance === 'street' ? ['WALK', 'LINE'] : ['LINE']))

  async function loadDistances (): Promise<void> {
    for (const mode of distanceModes.value) {
      const pairs = stopPairs(stopPoints.value).filter(([a, b]) => !distancesRequested.has(`${mode}|${stopPairKey(a.id, b.id)}`))
      for (const [a, b] of pairs) {
        distancesRequested.add(`${mode}|${stopPairKey(a.id, b.id)}`)
      }
      for (let i = 0; i < pairs.length; i += STOP_DISTANCE_BATCH_SIZE) {
        const batch = pairs.slice(i, i + STOP_DISTANCE_BATCH_SIZE)
        distancesLoading.value++
        try {
          const { query, variables } = stopDistancesRequest(batch, mode)
          const response = await resolveClient().query<StopDistancesResponse>({ query, variables, fetchPolicy: 'no-cache', errorPolicy: 'all' })
          const known = distances.value.get(mode) ?? new Map<string, number>()
          for (const [key, meters] of parseStopDistances(batch, response.data)) {
            known.set(key, meters)
          }
          distances.value.set(mode, known)
          triggerRef(distances)
        } catch (err: any) {
          // Let a retry ask again.
          for (const [a, b] of batch) {
            distancesRequested.delete(`${mode}|${stopPairKey(a.id, b.id)}`)
          }
          distancesError.value = err?.message || String(err)
        } finally {
          distancesLoading.value--
        }
      }
    }
  }

  // Meters between two different stops from the chosen source, falling back
  // to a straight line; undefined where neither is known.
  function walkMeters (a: number, b: number): number | undefined {
    const key = stopPairKey(a, b)
    return distanceModes.value.map(mode => distances.value.get(mode)?.get(key)).find(m => m !== undefined)
  }
  const unknownPairs = computed(() => stopPairs(stopPoints.value).filter(([a, b]) => walkMeters(a.id, b.id) === undefined).length)
  const secondsPerMeter = computed(() => Math.max(0, Number(settings.value.secondsPerMeter) || 0))
  const maxWalkSeconds = computed(() => {
    let most = 0
    for (const [a, b] of stopPairs(stopPoints.value)) {
      most = Math.max(most, (walkMeters(a.id, b.id) ?? 0) * secondsPerMeter.value)
    }
    return most
  })

  const events = computed(() => {
    const r = result.value
    if (!r || stopIds.value.length === 0) {
      return undefined
    }
    return transferEvents({
      stopIds: stopIds.value,
      dates: dates.value,
      ...timeWindow.value,
      stopDepartureCache: r.stopDepartureCache,
      tripDetails: store.details.value,
    })
  })

  // The routes arriving and departing, each with its headsigns and how many
  // trips each has, for the settings' route tree.
  const routeChoices = computed(() => {
    const tree = (events: TransferEvent[]): TransferRouteChoice[] => {
      const byRoute = new Map<number, Map<string, number>>()
      for (const e of events) {
        const headsigns = byRoute.get(e.routeId) ?? new Map<string, number>()
        headsigns.set(e.headsign ?? '', (headsigns.get(e.headsign ?? '') || 0) + 1)
        byRoute.set(e.routeId, headsigns)
      }
      return [...byRoute].map(([id, headsigns]) => {
        const route = routes.value.get(id)
        return {
          id,
          label: route?.route_short_name || route?.route_long_name || route?.route_id || String(id),
          longName: route?.route_long_name ?? '',
          color: route?.route_color ?? '',
          textColor: route?.route_text_color ?? '',
          headsigns: [...headsigns]
            .map(([headsign, count]) => ({ key: transferRouteKey({ routeId: id, headsign }), label: headsign || '(no headsign)', count }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        }
      }).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    }
    return {
      from: tree(events.value?.arrivals ?? []),
      to: tree(events.value?.departures ?? []),
    }
  })

  const groups = computed(() => {
    const e = events.value
    if (!e) {
      return []
    }
    const fromOut = new Set(settings.value.excludedFrom)
    const toOut = new Set(settings.value.excludedTo)
    const spm = secondsPerMeter.value
    return calculateTransfers(
      e.arrivals.filter(a => !fromOut.has(transferRouteKey(a))),
      e.departures.filter(d => !toOut.has(transferRouteKey(d))),
      {
        walkSeconds: (from, to) => (from === to ? 0 : (walkMeters(from, to) ?? Number.NaN) * spm),
        maxWalkSeconds: maxWalkSeconds.value,
        breakpoints: breakpoints.value,
        allConnections: settings.value.allConnections,
      },
    )
  })

  // The dates with arrivals, for the date picker.
  const individualDates = computed(() => dates.value.filter(d => groups.value.some(g => calendarTime(g.arrival.time).date === d)))
  const pickedDate = computed(() => (selectedDate.value && individualDates.value.includes(selectedDate.value) ? selectedDate.value : undefined))

  // The Summary covers every date unless one is picked.
  const summaryGroups = computed(() => filterTransferGroups(groups.value, pickedDate.value, timeBand.value))
  const summaryRows = computed(() => transferSummaryRows(summarizeTransfers(summaryGroups.value), routes.value))
  const summaryCounts = computed(() => transferGradeCounts(summaryGroups.value))
  const summaryOverview = computed(() => transferOverview(summaryGroups.value))

  // The Individual report shows one date: the one picked, or the first.
  const individualDate = computed(() => pickedDate.value ?? individualDates.value[0])
  const individualGroups = computed(() => filterTransferGroups(groups.value, individualDate.value, timeBand.value))
  const individualRows = computed(() => transferRows(individualGroups.value, {
    routes: routes.value,
    stops: stops.value,
    tripDetails: store.details.value,
  }))
  const individualCounts = computed(() => transferGradeCounts(individualGroups.value))
  const individualOverview = computed(() => transferOverview(individualGroups.value))
  // Each connection on the date by the arrival's time of day, for the chart.
  const individualPoints = computed(() => individualGroups.value.flatMap(g => g.connections.map(c => ({
    hour: calendarTime(g.arrival.time).seconds / 3600,
    waitMinutes: c.wait / 60,
    grade: c.grade,
  }))))

  const detailsError = ref<string | null>(null)
  // The trips' details and the stops' distances the report needs.
  async function load (): Promise<void> {
    const r = result.value
    if (!r || stopIds.value.length === 0) {
      return
    }
    detailsError.value = null
    distancesError.value = null
    const distancesLoaded = loadDistances()
    detailsError.value = await store.load(transferTripIds({
      stopIds: stopIds.value,
      dates: dates.value,
      ...timeWindow.value,
      stopDepartureCache: r.stopDepartureCache,
      // The longest walk the settings could give, as distances may still be
      // arriving: a few minutes' slack on the trips asked for.
      maxWalkSeconds: Math.max(maxWalkSeconds.value, 15 * 60),
      breakpoints: breakpoints.value,
    }))
    await distancesLoaded
  }

  // The subject by name, as the report's heading and download names.
  const title = computed(() => {
    const s = toValue(deps.subject)
    if (s?.kind === 'stop') {
      const stop = stops.value.get(s.stopId)
      return stop?.stop_name || stop?.stop_id || ''
    }
    return cluster.value ? clusterDisplayName(cluster.value.name, cluster.value.nearName) : ''
  })

  // What the report can be about: the scenario's clusters, then its stops
  // with service, each by name.
  const subjectOptions = computed(() => {
    const r = result.value
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    return {
      clusters: (r?.stopClusters || [])
        .map(c => ({ key: transferSubjectKey({ kind: 'cluster', clusterId: c.id }), label: clusterDisplayName(c.name, c.nearName) }))
        .sort(byLabel),
      stops: (r?.stops || [])
        .filter(s => s.marked)
        .map(s => ({ key: transferSubjectKey({ kind: 'stop', stopId: s.id }), label: s.stop_name || s.stop_id }))
        .sort(byLabel),
    }
  })

  return {
    title,
    subjectOptions,
    settings,
    breakpoints,
    routeChoices,
    selectedDate,
    summaryDate: pickedDate,
    timeBand,
    available: computed(() => stopIds.value.length > 0),
    arrivalCount: computed(() => events.value?.arrivals.length ?? 0),
    missingDetails: computed(() => events.value?.missingDetails ?? 0),
    summaryRows,
    summaryCounts,
    summaryOverview,
    individualDates,
    individualDate,
    individualRows,
    individualCounts,
    individualOverview,
    individualPoints,
    detailsLoading: computed(() => store.loading.value || distancesLoading.value > 0),
    detailsError: computed(() => detailsError.value ?? (distancesError.value ? `distances between stops: ${distancesError.value}` : null)),
    // Pairs of the stops with no distance to walk between them, which are
    // left out.
    unknownPairs: computed(() => (distancesLoading.value > 0 ? 0 : unknownPairs.value)),
    load,
  }
}

// A stop or cluster as a picker's value, and back.
export function transferSubjectKey (subject: TripSubject | undefined): string {
  if (subject?.kind === 'stop') {
    return `stop:${subject.stopId}`
  }
  return subject?.kind === 'cluster' ? `cluster:${subject.clusterId}` : ''
}

export function transferSubjectFromKey (key: string): TripSubject | undefined {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'stop' && Number.isFinite(Number(id))) {
    return { kind: 'stop', stopId: Number(id) }
  }
  return kind === 'cluster' && id ? { kind: 'cluster', clusterId: id } : undefined
}
