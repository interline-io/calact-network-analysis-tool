// Transfers at a stop or stop cluster: its arrivals paired with the departures
// soon after, and graded.
//
// Trip details come from the store the trip panel and table share, and
// distances between the stops from the Transitland directions API.

import { computed, ref, shallowRef, toValue, triggerRef, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import {
  DEFAULT_TRANSFER_SETTINGS,
  calculateTransfers,
  centerOf,
  clusterDisplayName,
  resolveEffectiveWeekdays,
  routeLabel,
  summarizeTransfers,
  transferCompassPlaces,
  transferRose,
  transferEvents,
  transferGrid,
  transferOverview,
  transferRows,
  transferSummaryGrid,
  transferSummaryRows,
  transferTripChoices,
  transferTripInfo,
  transferTripKey,
  validBreakpoints,
  type ScenarioFilterResult,
  type TransferSettings,
  type TripSubject,
} from '~~/src/scenario'
import { scopeDatesToWeekdays } from '~~/src/scenario/route-headway'
import { fmtDate, groupBy, timeWindowSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
import {
  parseStopDistance,
  routesById,
  stopDistanceQuery,
  stopDistanceVariables,
  stopPairKey,
  stopPairs,
  type Stop,
  type StopDistanceMode,
  type StopDistanceResponse,
  type StopPoint,
} from '~~/src/tl'
import type { TripDetailsStore } from './useTripPanel'

// The inputs useSubjectTransfers reads.
export interface UseSubjectTransfersDeps {
  // A stop or cluster; a route has no transfers of its own.
  subject: MaybeRefOrGetter<TripSubject | undefined>
  scenarioFilterResult: MaybeRefOrGetter<ScenarioFilterResult | undefined>
  selectedDateRange: MaybeRefOrGetter<Date[]>
  selectedWeekdays: MaybeRefOrGetter<Weekday[] | undefined>
  selectedWeekdayMode: MaybeRefOrGetter<WeekdayMode | undefined>
  startTime: MaybeRefOrGetter<Date | undefined>
  endTime: MaybeRefOrGetter<Date | undefined>
  // Whether the report is shown; trip details and stop distances load only
  // then.
  active: MaybeRefOrGetter<boolean>
  // Stops added to the subject's own, and own stops removed, so a station's
  // other platform can join a cluster. Kept in the URL and cleared for each
  // new subject.
  stopEdits: Ref<TransferStopEdits>
  // The date whose arrivals both views show (yyyy-MM-dd); the first with
  // service when unset. Kept in the URL.
  selectedDate: MaybeRefOrGetter<string | undefined>
}

// Stops added to a subject's own, and own stops removed.
export interface TransferStopEdits {
  added: number[]
  removed: number[]
}

// Distance requests at once.
const DISTANCES_CONCURRENCY = 4

// The Transfer Analyst's data for a subject, built while the report is shown.
export function useSubjectTransfers (deps: UseSubjectTransfersDeps, store: TripDetailsStore) {
  const settings = ref<TransferSettings>({ ...DEFAULT_TRANSFER_SETTINGS })
  // Breakpoints that cannot grade waits are not applied.
  const breakpoints = computed(() => (validBreakpoints(settings.value.breakpoints) ? settings.value.breakpoints : DEFAULT_TRANSFER_SETTINGS.breakpoints))

  const result = computed(() => toValue(deps.scenarioFilterResult))
  const routes = computed(() => routesById(result.value?.routes || []))
  const stops = computed(() => new Map<number, Stop>((result.value?.stops || []).map(s => [s.id, s])))
  const cluster = computed(() => {
    const s = toValue(deps.subject)
    return s?.kind === 'cluster' ? result.value?.stopClusters?.find(c => c.id === s.clusterId) : undefined
  })
  // Stops by their parent station (its feed version and GTFS id).
  const parentKey = (stop: Stop | undefined) => (stop?.parent?.stop_id ? `${stop.feed_version.sha1}|${stop.parent.stop_id}` : undefined)
  // Those with service only, as the Stops & platforms list shows.
  const stopsByParent = computed(() => groupBy([...stops.value.values()].filter(s => s.marked && parentKey(s)), s => parentKey(s)!))
  // The subject's own stops and the other stops of their parent stations, as
  // riders transfer at a station's other platforms too, which a cluster of one
  // stop per agency omits. A cluster's members follow the filters.
  const subjectStopIds = computed((): number[] => {
    const s = toValue(deps.subject)
    const own = s?.kind === 'stop'
      ? (stops.value.has(s.stopId) ? [s.stopId] : [])
      : (cluster.value?.memberStopIds ?? [])
    const ids = new Set(own)
    for (const id of own) {
      const key = parentKey(stops.value.get(id))
      for (const sibling of (key && stopsByParent.value.get(key)) || []) {
        ids.add(sibling.id)
      }
    }
    return [...ids]
  })
  // Keeps the same array while the stops are unchanged, so a URL write that
  // changes nothing here doesn't recompute what depends on the stops.
  const stopIds = computed((previous?: number[]): number[] => {
    const { added, removed } = deps.stopEdits.value
    const out = new Set(removed)
    const own = subjectStopIds.value.filter(id => !out.has(id))
    const next = [...own, ...added.filter(id => stops.value.has(id) && !own.includes(id))]
    return previous && previous.length === next.length && previous.every((id, i) => id === next[i]) ? previous : next
  })
  // Records the picked stops as additions to, and removals from, the
  // subject's own.
  function setStopIds (ids: number[]) {
    const own = new Set(subjectStopIds.value)
    const picked = new Set(ids)
    deps.stopEdits.value = {
      added: ids.filter(id => !own.has(id)),
      removed: subjectStopIds.value.filter(id => !picked.has(id)),
    }
  }
  // Every stop with service, for adding to the subject: its name, operators,
  // and routes, and whether it is a platform in a station.
  const mapStops = computed(() => (result.value?.stops || [])
    .filter(s => s.marked)
    .map((s) => {
      const stopRoutes = s.route_stops.map(rs => routes.value.get(rs.route_id))
      const names = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].join(', ')
      const [lon, lat] = s.geometry.coordinates
      return {
        id: s.id,
        name: s.stop_name || s.stop_id,
        operator: names(stopRoutes.map(r => r?.agency_name)),
        routes: names(stopRoutes.map(r => r?.route_short_name || r?.route_long_name)),
        platform: !!s.parent?.stop_id,
        routeIds: s.route_stops.map(rs => rs.route_id),
        lon: lon!,
        lat: lat!,
      }
    }))
  // The routes at those stops, with their representative lines.
  const mapRoutes = computed(() => [...new Set(mapStops.value.flatMap(s => s.routeIds))]
    .map(id => routes.value.get(id))
    .filter(r => !!r?.geometry)
    .map(r => ({
      id: r!.id,
      name: routeLabel(r),
      operator: r!.agency_name,
      color: r!.route_color || undefined,
      geometry: r!.geometry!,
    })))
  // The scenario's dates, scoped to its weekdays as the other reports are.
  const dates = computed(() => scopeDatesToWeekdays(
    toValue(deps.selectedDateRange),
    resolveEffectiveWeekdays(toValue(deps.selectedWeekdays), toValue(deps.selectedWeekdayMode)),
  ).map(d => fmtDate(d)))
  const timeWindow = computed(() => timeWindowSeconds(toValue(deps.startTime), toValue(deps.endTime)))

  // Meters between pairs of stops, by mode, then stopPairKey; kept across
  // subjects, as a pair's distance does not change.
  const distances = shallowRef(new Map<StopDistanceMode, Map<string, number>>())
  const distancesRequested = new Set<string>()
  const distancesLoading = ref(0)
  const distancesError = ref<string | null>(null)
  // The distancesKey of the last load to settle, so pairs not yet requested
  // don't count as having no distance.
  const distancesFor = ref('')
  const { resolveClient } = useApolloClient()

  const stopPoints = computed((): StopPoint[] => stopIds.value.flatMap((id) => {
    const [lon, lat] = stops.value.get(id)?.geometry.coordinates ?? []
    return lon !== undefined && lat !== undefined ? [{ id, lon, lat }] : []
  }))
  // Every pair of the stops, each requested once, in a request of its own.
  // Pairs grow as the square of the stops (40 platforms make 780), so a large
  // station would call for requesting only pairs within a plausible walk.
  const pairs = computed(() => stopPairs(stopPoints.value))
  // The distance sources to read: a straight line always, as the street
  // network's fallback where it cannot route a pair. A computed of its own, so
  // a change to another setting leaves the distance requests alone.
  const walkDistance = computed(() => settings.value.walkDistance)
  const distanceModes = computed((): StopDistanceMode[] => (walkDistance.value === 'street' ? ['WALK', 'LINE'] : ['LINE']))
  const distancesKey = computed(() => `${distanceModes.value.join(',')}|${stopIds.value.join(',')}`)

  // Fetches each mode's distances for the pairs not yet requested, a few
  // pairs at a time, and applies the results together.
  async function loadDistances (): Promise<void> {
    const asked = distancesKey.value
    const requestKey = (mode: StopDistanceMode, a: StopPoint, b: StopPoint) => `${mode}|${stopPairKey(a.id, b.id)}`
    const requests = distanceModes.value.flatMap(mode => pairs.value
      .filter(([a, b]) => !distancesRequested.has(requestKey(mode, a, b)))
      .map(([a, b]) => ({ mode, a, b })))
    for (const { mode, a, b } of requests) {
      distancesRequested.add(requestKey(mode, a, b))
    }
    // Settles only while this load is still current, so an older load that
    // ends after a newer one can't overwrite the newer one's key.
    const settle = () => {
      if (asked === distancesKey.value) {
        distancesFor.value = asked
      }
    }
    if (requests.length === 0) {
      settle()
      return
    }
    distancesLoading.value++
    // One pair's distance, or why it failed.
    const fetchPair = async ({ mode, a, b }: typeof requests[number]) => {
      // The query rejects only on a network error; the server's own errors
      // come back in the response.
      const outcome = await resolveClient()
        .query<StopDistanceResponse>({ query: stopDistanceQuery, variables: stopDistanceVariables(a, b, mode), fetchPolicy: 'no-cache', errorPolicy: 'all' })
        .then(response => ({ response }), (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }))
      if ('error' in outcome) {
        return { mode, a, b, error: outcome.error }
      }
      const { response } = outcome
      if (!response.data && response.errors?.length) {
        return { mode, a, b, error: response.errors[0]!.message }
      }
      return { mode, a, b, meters: parseStopDistance(response.data) }
    }
    // A few requests at a time, as for trip details, each worker taking the
    // next pair: a station of many stops has hundreds of pairs.
    const results: Awaited<ReturnType<typeof fetchPair>>[] = []
    const queue = [...requests]
    await Promise.all(Array.from({ length: Math.min(DISTANCES_CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        results.push(await fetchPair(next))
      }
    }))
    for (const r of results) {
      if (r.error !== undefined) {
        // Let a retry ask again.
        distancesRequested.delete(requestKey(r.mode, r.a, r.b))
        distancesError.value ??= r.error
        continue
      }
      // An unrouted pair has no distance, and stays out of the table.
      if (r.meters !== undefined) {
        const known = distances.value.get(r.mode) ?? new Map<string, number>()
        known.set(stopPairKey(r.a.id, r.b.id), r.meters)
        distances.value.set(r.mode, known)
      }
    }
    triggerRef(distances)
    settle()
    distancesLoading.value--
  }

  const secondsPerMeter = computed(() => Math.max(0, Number(settings.value.secondsPerMeter) || 0))
  // Walking seconds between each pair of the stops, from the chosen source,
  // falling back to a straight line. Built once per change of distances or
  // pace, as every candidate connection reads the table.
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

  // How far the departures reach: only the outer breakpoints and the longest
  // walk, so editing an inner breakpoint or loading a shorter distance doesn't
  // recompute the events.
  const missedReach = computed(() => breakpoints.value[0]!)
  const waitReach = computed(() => breakpoints.value[breakpoints.value.length - 1]!)
  const mostWalk = computed(() => walkTable.value.most)
  // The dates with service at the stops in the time of day, from the
  // departures alone, for the date picker: both views show one date.
  const individualDates = computed(() => {
    const cache = result.value?.stopDepartureCache
    const { startTime, endTime } = timeWindow.value
    return cache
      ? dates.value.filter(d => stopIds.value.some(id => cache.get(id, d).some((st) => {
          const t = st.departureTime % 86400
          return t >= startTime && t <= endTime
        })))
      : []
  })
  // The one picked, or the first.
  const individualDate = computed(() => {
    const picked = toValue(deps.selectedDate)
    return picked && individualDates.value.includes(picked) ? picked : individualDates.value[0]
  })

  // The date's arrivals and the departures they can reach: everything the
  // views show, and so the only trips whose details are fetched.
  const events = computed(() => {
    const r = result.value
    if (!r || stopIds.value.length === 0 || !individualDate.value) {
      return undefined
    }
    return transferEvents({
      stopIds: stopIds.value,
      date: individualDate.value,
      ...timeWindow.value,
      stopDepartureCache: r.stopDepartureCache,
      tripDetails: store.details.value,
      maxWalkSeconds: mostWalk.value,
      minWait: missedReach.value,
      maxWait: waitReach.value,
    })
  })

  // Which side of the date has connections the report cannot see: departures
  // after midnight past the query's last date, or before midnight ahead of
  // its first, were never loaded.
  const midnightCut = computed((): 'before' | 'after' | undefined => {
    const date = individualDate.value
    const range = toValue(deps.selectedDateRange)
    const arrivals = events.value?.arrivals ?? []
    if (!date || range.length === 0 || arrivals.length === 0) {
      return undefined
    }
    if (date === fmtDate(range[range.length - 1]!) && arrivals.at(-1)!.seconds + mostWalk.value + waitReach.value > 86400) {
      return 'after'
    }
    return date === fmtDate(range[0]!) && arrivals[0]!.seconds + missedReach.value < 0 ? 'before' : undefined
  })

  // The trips arriving and departing as routes, directions, and
  // destinations, for the settings' trip filtering.
  const routeChoices = computed(() => ({
    from: transferTripChoices(events.value?.arrivals ?? [], routes.value, 'from'),
    to: transferTripChoices(events.value?.departures ?? [], routes.value, 'to'),
  }))
  // The same by destination, for the tables' names and tags.
  const tripInfo = computed(() => ({
    routes: routes.value,
    from: transferTripInfo(routeChoices.value.from),
    to: transferTripInfo(routeChoices.value.to),
  }))

  // The settings the calculation reads, each a computed of its own setting,
  // so a change to another setting doesn't recompute what depends on these.
  const excludedFromKeys = computed(() => settings.value.excludedFrom)
  const excludedToKeys = computed(() => settings.value.excludedTo)
  const allConnections = computed(() => settings.value.allConnections)
  const countSameWay = computed(() => settings.value.countSameWay)
  const excludedFrom = computed(() => new Set(excludedFromKeys.value))
  const excludedTo = computed(() => new Set(excludedToKeys.value))
  const arrivals = computed(() => (events.value?.arrivals ?? []).filter(a => !excludedFrom.value.has(transferTripKey(a))))

  // The date's arrivals and their connections. Excluded departures are
  // dropped afterward: each destination's first connection is found apart
  // from the others', so dropping some leaves the rest unchanged.
  const allDateGroups = computed(() => {
    const e = events.value
    if (!e) {
      return []
    }
    const { table } = walkTable.value
    return calculateTransfers(
      arrivals.value,
      e.departures,
      {
        walkSeconds: (from, to) => (from === to ? 0 : (table.get(from)?.get(to) ?? Number.NaN)),
        maxWalkSeconds: mostWalk.value,
        breakpoints: breakpoints.value,
        allConnections: allConnections.value,
        countSameWay: countSameWay.value,
      },
    )
  })
  const dateGroups = computed(() => {
    const out = excludedTo.value
    return out.size === 0
      ? allDateGroups.value
      : allDateGroups.value.map(g => ({ ...g, connections: g.connections.filter(c => !out.has(transferTripKey(c.departure))) }))
  })
  const overview = computed(() => transferOverview(dateGroups.value))

  const summary = computed(() => summarizeTransfers(dateGroups.value))
  const summaryGrid = computed(() => transferSummaryGrid(summary.value, tripInfo.value))
  // Arriving trips' origins and departing trips' destinations, placed around
  // the middle of the stops.
  const compass = computed(() => {
    const center = centerOf(stopPoints.value.map((p): [number, number] => [p.lon, p.lat]))
    return {
      from: center ? transferCompassPlaces(routeChoices.value.from, 'from', center) : [],
      to: center ? transferCompassPlaces(routeChoices.value.to, 'to', center) : [],
    }
  })
  // The connections between those places, for the Compass view.
  const rose = computed(() => transferRose(summary.value, compass.value, tripInfo.value))

  // The views' rows as flat CSV records, built on demand.
  function csvRows (kind: 'summary' | 'connections'): Record<string, unknown>[] {
    return kind === 'summary'
      ? transferSummaryRows(summary.value, routes.value) as unknown as Record<string, unknown>[]
      : transferRows(dateGroups.value, { routes: routes.value, stops: stops.value, tripDetails: store.details.value }) as unknown as Record<string, unknown>[]
  }
  const individualGrid = computed(() => transferGrid(dateGroups.value, { ...tripInfo.value, stops: stops.value }))
  // Each connection on the date by the arrival's time of day, for the chart.
  const individualPoints = computed(() => dateGroups.value.flatMap((g) => {
    const hour = g.arrival.seconds / 3600
    return g.connections.map(c => ({ hour, waitMinutes: c.wait / 60, grade: c.grade }))
  }))

  // Loads the missing trip details and stop distances while the report is
  // shown.
  //
  // Each source follows its own inputs, as distances can widen which trips
  // need details: a longer walk reaches later departures. After a failure, a
  // source waits for a retry rather than asking again at once, and the other
  // source keeps loading.
  const detailsError = ref<string | null>(null)
  async function load (): Promise<void> {
    if (!toValue(deps.active) || stopIds.value.length === 0) {
      return
    }
    await Promise.all([
      distancesError.value ? undefined : loadDistances(),
      // A load that succeeds leaves another's failure for a retry to clear.
      detailsError.value
        ? undefined
        : store.load(events.value?.missingTripIds ?? []).then((err) => {
            if (err) {
              detailsError.value = err
            }
          }),
    ])
  }
  function retry (): Promise<void> {
    detailsError.value = null
    distancesError.value = null
    return load()
  }
  // A new scenario starts afresh, not held back by the last one's failure.
  watch(() => result.value?.stopDepartureCache, () => {
    detailsError.value = null
    distancesError.value = null
  })
  // Nothing is read while hidden, so the report does no work then; each
  // source compared by value, so a recompute that changes nothing loads
  // nothing.
  const active = () => toValue(deps.active)
  watch(
    [active, () => (active() ? pairs.value : undefined), () => (active() ? distanceModes.value : undefined), () => (active() ? (events.value?.missingTripIds ?? []).join(',') : '')],
    () => load(),
  )

  // The subject's name.
  const subjectName = computed(() => {
    const s = toValue(deps.subject)
    if (s?.kind === 'stop') {
      const stop = stops.value.get(s.stopId)
      return stop?.stop_name || stop?.stop_id || ''
    }
    return cluster.value ? clusterDisplayName(cluster.value.name, cluster.value.nearName) : ''
  })
  // Whether the picked stops differ from the subject's own.
  const custom = computed(() => deps.stopEdits.value.added.length > 0 || deps.stopEdits.value.removed.length > 0)
  // The subject's name, with its count of stops once they have been changed.
  const title = computed(() => (custom.value ? `${subjectName.value} (${stopIds.value.length} stops)` : subjectName.value))

  // The subjects to offer: the scenario's clusters, then its stops with
  // service, each by name.
  const subjectOptions = computed(() => {
    const r = result.value
    const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    return {
      clusters: distinctLabels((r?.stopClusters || [])
        .map(c => ({
          key: transferSubjectKey({ kind: 'cluster', clusterId: c.id }),
          label: clusterDisplayName(c.name, c.nearName),
          // To tell apart clusters of the same name: their members' names.
          memberNames: c.memberStopIds.map(id => stops.value.get(id)?.stop_name).filter((n): n is string => !!n),
        })))
        .sort(byLabel),
      stops: (r?.stops || [])
        .filter(s => s.marked)
        .map(s => ({ key: transferSubjectKey({ kind: 'stop', stopId: s.id }), label: s.stop_name || s.stop_id }))
        .sort(byLabel),
    }
  })

  return {
    title,
    // For a custom set of stops, the subject they came from.
    customFrom: computed(() => (custom.value ? subjectName.value : undefined)),
    subjectOptions,
    stopIds,
    setStopIds,
    mapStops,
    mapRoutes,
    settings,
    breakpoints,
    routeChoices,
    compass,
    rose,
    missingDetails: computed(() => events.value?.missingTripIds.length ?? 0),
    csvRows,
    summaryGrid,
    overview,
    individualDates,
    individualDate,
    midnightCut,
    individualGrid,
    individualPoints,
    detailsLoading: computed(() => store.loading.value || distancesLoading.value > 0),
    detailsError: computed(() => detailsError.value ?? (distancesError.value ? `distances between stops: ${distancesError.value}` : null)),
    // Pairs of the stops with no distance to walk between them, which are
    // left out.
    unknownPairs: computed(() => (distancesLoading.value > 0 || distancesFor.value !== distancesKey.value ? 0 : walkTable.value.unknown)),
    retry,
  }
}

// Clusters whose names are the same, each told apart by a member's name the
// others lack.
function distinctLabels (clusters: { key: string, label: string, memberNames: string[] }[]): { key: string, label: string }[] {
  const byLabel = groupBy(clusters, c => c.label)
  return clusters.map((c) => {
    const same = byLabel.get(c.label)!.filter(o => o !== c)
    if (same.length === 0) {
      return { key: c.key, label: c.label }
    }
    const theirs = new Set(same.flatMap(o => o.memberNames))
    const own = c.memberNames.find(n => !theirs.has(n) && n !== c.label)
    return { key: c.key, label: own ? `${c.label} (${own})` : c.label }
  })
}

// A stop or cluster as a picker's value.
export function transferSubjectKey (subject: TripSubject | undefined): string {
  if (subject?.kind === 'stop') {
    return `stop:${subject.stopId}`
  }
  return subject?.kind === 'cluster' ? `cluster:${subject.clusterId}` : ''
}

// The stop or cluster a picker's value names, if any.
export function transferSubjectFromKey (key: string): TripSubject | undefined {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
  if (kind === 'stop' && Number.isFinite(Number(id))) {
    return { kind: 'stop', stopId: Number(id) }
  }
  return kind === 'cluster' && id ? { kind: 'cluster', clusterId: id } : undefined
}
