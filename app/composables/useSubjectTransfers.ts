// Transfers at a stop or stop cluster: its arrivals paired with the departures
// soon after, graded, as the Reports tab's Transfer Analyst shows them.
//
// Called from tne.vue, which passes the results to <cal-transfer-report> as
// props. Trip details come from the store the trip panel and table share;
// distances between the stops, from the Transitland directions API.

import { computed, ref, shallowRef, toValue, triggerRef, watch, type MaybeRefOrGetter } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import {
  DEFAULT_TRANSFER_SETTINGS,
  calculateTransfers,
  clusterDisplayName,
  filterTransferGroups,
  resolveEffectiveWeekdays,
  summarizeTransfers,
  transferEvents,
  transferOverview,
  transferRows,
  transferSummaryRows,
  transferTripChoices,
  transferTripKey,
  validBreakpoints,
  type ScenarioFilterResult,
  type TransferSettings,
  type TransferTimeBand,
  type TripSubject,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { chunkArray, fmtDate, timeWindowSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
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
  // While the report is shown: the trip details and stop distances it needs
  // are fetched then, as they come to be needed.
  active: MaybeRefOrGetter<boolean>
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
  ).map(d => fmtDate(d)))
  const timeWindow = computed(() => timeWindowSeconds(toValue(deps.startTime), toValue(deps.endTime)))

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
  const pairs = computed(() => stopPairs(stopPoints.value))
  // The sources the walk reads: a straight line always, as the street
  // network's fallback where it cannot route a pair. Read through the one
  // setting, so other settings changing leave it, and what follows it, be.
  const walkDistance = computed(() => settings.value.walkDistance)
  const distanceModes = computed((): StopDistanceMode[] => (walkDistance.value === 'street' ? ['WALK', 'LINE'] : ['LINE']))

  // Each mode's pairs not yet asked for, fetched in parallel batches, and
  // applied together.
  async function loadDistances (): Promise<void> {
    const requestKey = (mode: StopDistanceMode, a: StopPoint, b: StopPoint) => `${mode}|${stopPairKey(a.id, b.id)}`
    const batches = distanceModes.value.flatMap((mode) => {
      const wanted = pairs.value.filter(([a, b]) => !distancesRequested.has(requestKey(mode, a, b)))
      for (const [a, b] of wanted) {
        distancesRequested.add(requestKey(mode, a, b))
      }
      return chunkArray(wanted, STOP_DISTANCE_BATCH_SIZE).map(batch => ({ mode, batch }))
    })
    if (batches.length === 0) {
      return
    }
    distancesLoading.value++
    const results = await Promise.all(batches.map(async ({ mode, batch }) => {
      try {
        const { query, variables } = stopDistancesRequest(batch, mode)
        const response = await resolveClient().query<StopDistancesResponse>({ query, variables, fetchPolicy: 'no-cache', errorPolicy: 'all' })
        if (!response.data && response.errors?.length) {
          throw new Error(response.errors[0]!.message)
        }
        return { mode, meters: parseStopDistances(batch, response.data) }
      } catch (err: any) {
        // Let a retry ask again.
        for (const [a, b] of batch) {
          distancesRequested.delete(requestKey(mode, a, b))
        }
        distancesError.value = err?.message || String(err)
        return undefined
      }
    }))
    for (const r of results) {
      if (r) {
        const known = distances.value.get(r.mode) ?? new Map<string, number>()
        for (const [key, meters] of r.meters) {
          known.set(key, meters)
        }
        distances.value.set(r.mode, known)
      }
    }
    triggerRef(distances)
    distancesLoading.value--
  }

  // Walking seconds between each pair of the stops, from the chosen source,
  // falling back to a straight line; built once per change of distances or
  // pace, as every candidate connection reads it.
  const secondsPerMeter = computed(() => Math.max(0, Number(settings.value.secondsPerMeter) || 0))
  const walkTable = computed(() => {
    const table = new Map<number, Map<number, number>>()
    let unknown = 0
    let most = 0
    for (const [a, b] of pairs.value) {
      const key = stopPairKey(a.id, b.id)
      const meters = distanceModes.value.map(mode => distances.value.get(mode)?.get(key)).find(m => m !== undefined)
      if (meters === undefined) {
        unknown += 1
        continue
      }
      const seconds = meters * secondsPerMeter.value
      most = Math.max(most, seconds)
      for (const [from, to] of [[a.id, b.id], [b.id, a.id]] as const) {
        const row = table.get(from) ?? new Map<number, number>()
        row.set(to, seconds)
        table.set(from, row)
      }
    }
    return { table, unknown, most }
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
      maxWalkSeconds: walkTable.value.most,
      breakpoints: breakpoints.value,
    })
  })

  // The trips arriving and departing as routes, directions, and
  // destinations, for the settings' trip filtering.
  const routeChoices = computed(() => ({
    from: transferTripChoices(events.value?.arrivals ?? [], routes.value),
    to: transferTripChoices(events.value?.departures ?? [], routes.value),
  }))

  const groups = computed(() => {
    const e = events.value
    if (!e) {
      return []
    }
    const fromOut = new Set(settings.value.excludedFrom)
    const toOut = new Set(settings.value.excludedTo)
    const { table, most } = walkTable.value
    return calculateTransfers(
      e.arrivals.filter(a => !fromOut.has(transferTripKey(a))),
      e.departures.filter(d => !toOut.has(transferTripKey(d))),
      {
        walkSeconds: (from, to) => (from === to ? 0 : (table.get(from)?.get(to) ?? Number.NaN)),
        maxWalkSeconds: most,
        breakpoints: breakpoints.value,
        allConnections: settings.value.allConnections,
      },
    )
  })

  // The dates with arrivals, for the date picker.
  const individualDates = computed(() => {
    const withArrivals = new Set(groups.value.map(g => g.arrival.date))
    return dates.value.filter(d => withArrivals.has(d))
  })
  const pickedDate = computed(() => (selectedDate.value && individualDates.value.includes(selectedDate.value) ? selectedDate.value : undefined))

  // The Summary covers every date unless one is picked.
  const summaryGroups = computed(() => filterTransferGroups(groups.value, pickedDate.value, timeBand.value))
  const summaryRows = computed(() => transferSummaryRows(summarizeTransfers(summaryGroups.value), routes.value))
  const summaryOverview = computed(() => transferOverview(summaryGroups.value))

  // The Individual report shows one date: the one picked, or the first.
  const individualDate = computed(() => pickedDate.value ?? individualDates.value[0])
  const individualGroups = computed(() => filterTransferGroups(groups.value, individualDate.value, timeBand.value))
  const individualRows = computed(() => transferRows(individualGroups.value, {
    routes: routes.value,
    stops: stops.value,
    tripDetails: store.details.value,
  }))
  const individualOverview = computed(() => transferOverview(individualGroups.value))
  // Each connection on the date by the arrival's time of day, for the chart.
  const individualPoints = computed(() => individualGroups.value.flatMap((g) => {
    const hour = g.arrival.seconds / 3600
    return g.connections.map(c => ({ hour, waitMinutes: c.wait / 60, grade: c.grade }))
  }))

  // While shown, the details of the trips the report is missing, and the
  // distances between its stops. Each widens what the other needs (a longer
  // walk reaches later departures), so both follow their own inputs. After a
  // failure, loading waits for a retry rather than asking again at once.
  const detailsError = ref<string | null>(null)
  const failed = computed(() => !!detailsError.value || !!distancesError.value)
  async function load (): Promise<void> {
    if (!toValue(deps.active) || stopIds.value.length === 0 || failed.value) {
      return
    }
    await Promise.all([
      loadDistances(),
      store.load(events.value?.missingTripIds ?? []).then((err) => {
        detailsError.value = err
      }),
    ])
  }
  function retry (): Promise<void> {
    detailsError.value = null
    distancesError.value = null
    return load()
  }
  // Nothing is read while hidden, so the report does no work then.
  watch(
    () => (toValue(deps.active) ? [pairs.value, distanceModes.value, events.value?.missingTripIds] : undefined),
    () => load(),
  )

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
    missingDetails: computed(() => events.value?.missingTripIds.length ?? 0),
    summaryRows,
    summaryOverview,
    individualDates,
    individualDate,
    individualRows,
    individualOverview,
    individualPoints,
    detailsLoading: computed(() => store.loading.value || distancesLoading.value > 0),
    detailsError: computed(() => detailsError.value ?? (distancesError.value ? `distances between stops: ${distancesError.value}` : null)),
    // Pairs of the stops with no distance to walk between them, which are
    // left out.
    unknownPairs: computed(() => (distancesLoading.value > 0 ? 0 : walkTable.value.unknown)),
    retry,
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
