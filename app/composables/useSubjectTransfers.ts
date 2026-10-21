// Transfers at a stop or stop cluster: its arrivals paired with the departures
// soon after, graded, as the Reports tab's Transfers report shows them.
//
// Called from tne.vue, which passes the results to <cal-transfer-report> as
// props. Trip details come from the store the trip panel and table share.

import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { format } from 'date-fns'
import {
  calculateTransfers,
  calendarTime,
  clusterDisplayName,
  resolveEffectiveWeekdays,
  summarizeTransfers,
  transferEvents,
  transferGradeCounts,
  transferRows,
  transferSummaryRows,
  transferTripIds,
  type ScenarioFilterResult,
  type TripSubject,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { TRANSFER_WALK_SECONDS, dateToSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
import { routesById, type Stop } from '~~/src/tl'
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
  // Walking time between two different stops, in minutes; none at one stop.
  const walkMinutes = ref(TRANSFER_WALK_SECONDS / 60)
  // Every connection, rather than the first on each route and direction.
  const allConnections = ref(false)
  // The date the Individual report shows.
  const selectedDate = ref<string>()

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
  const walkSeconds = computed(() => Math.max(0, walkMinutes.value || 0) * 60)

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

  const groups = computed(() => {
    const e = events.value
    if (!e) {
      return []
    }
    const walk = walkSeconds.value
    return calculateTransfers(e.arrivals, e.departures, {
      walkSeconds: (from, to) => (from === to ? 0 : walk),
      maxWalkSeconds: walk,
      allConnections: allConnections.value,
    })
  })

  const summaryRows = computed(() => transferSummaryRows(summarizeTransfers(groups.value), routes.value))
  const summaryCounts = computed(() => transferGradeCounts(groups.value))

  // The dates with arrivals, for the Individual report's date picker.
  const individualDates = computed(() => dates.value.filter(d => groups.value.some(g => calendarTime(g.arrival.time).date === d)))
  const individualDate = computed(() => {
    const picked = selectedDate.value
    return picked && individualDates.value.includes(picked) ? picked : individualDates.value[0]
  })
  const individualGroups = computed(() => groups.value.filter(g => calendarTime(g.arrival.time).date === individualDate.value))
  const individualRows = computed(() => transferRows(individualGroups.value, {
    routes: routes.value,
    stops: stops.value,
    tripDetails: store.details.value,
  }))
  const individualCounts = computed(() => transferGradeCounts(individualGroups.value))
  // Each connection on the date by the arrival's time of day, for the chart.
  const individualPoints = computed(() => individualGroups.value.flatMap(g => g.connections.map(c => ({
    hour: calendarTime(g.arrival.time).seconds / 3600,
    waitMinutes: c.wait / 60,
    grade: c.grade,
  }))))

  const detailsError = ref<string | null>(null)
  async function loadDetails (): Promise<void> {
    const r = result.value
    if (!r || stopIds.value.length === 0) {
      return
    }
    detailsError.value = null
    detailsError.value = await store.load(transferTripIds({
      stopIds: stopIds.value,
      dates: dates.value,
      ...timeWindow.value,
      stopDepartureCache: r.stopDepartureCache,
      maxWalkSeconds: walkSeconds.value,
    }))
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
    walkMinutes,
    allConnections,
    selectedDate,
    available: computed(() => stopIds.value.length > 0),
    arrivalCount: computed(() => events.value?.arrivals.length ?? 0),
    missingDetails: computed(() => events.value?.missingDetails ?? 0),
    summaryRows,
    summaryCounts,
    individualDates,
    individualDate,
    individualRows,
    individualCounts,
    individualPoints,
    detailsLoading: store.loading,
    detailsError,
    loadDetails,
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
