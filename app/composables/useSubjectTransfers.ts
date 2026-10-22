// Transfers at a stop or stop cluster: its arrivals paired with the departures
// soon after, graded, as the Reports tab's Transfer Analyst shows them.
//
// Called from tne.vue, which passes the results to <cal-transfer-report> as
// props. Trip details come from the store the trip panel and table share;
// distances between the stops, from the Transitland directions API.

import { computed, ref, shallowRef, toValue, triggerRef, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useApolloClient } from '@vue/apollo-composable'
import {
  DEFAULT_TRANSFER_SETTINGS,
  calculateTransfers,
  centerOf,
  clusterDisplayName,
  resolveEffectiveWeekdays,
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
import { chunkArray, fmtDate, groupBy, timeWindowSeconds, type Weekday, type WeekdayMode } from '~~/src/core'
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
  // Stops added to the subject's, and of its own, those taken out: so a
  // station's other platform can join a cluster. Held by the page (in the
  // URL), which clears them for each subject.
  stopEdits: Ref<TransferStopEdits>
  // The date whose arrivals both views show (yyyy-MM-dd); the first with
  // service when unset. Held by the page, in the URL.
  selectedDate: MaybeRefOrGetter<string | undefined>
}

export interface TransferStopEdits {
  added: number[]
  removed: number[]
}

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
  const stopsByParent = computed(() => groupBy([...stops.value.values()].filter(parentKey), s => parentKey(s)!))
  // The subject's own stops: a cluster's members follow the filters, as the
  // trip panel's do. With them, the other stops of their parent stations, as
  // a station's other platforms, which a cluster of one stop per agency
  // leaves out, are where riders transfer too.
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
  // The same array while its stops stay the same, so what follows them (the
  // Individual table's columns and sort, among others) is left be by URL
  // writes that change nothing here.
  const stopIds = computed((previous?: number[]): number[] => {
    const { added, removed } = deps.stopEdits.value
    const out = new Set(removed)
    const own = subjectStopIds.value.filter(id => !out.has(id))
    const next = [...own, ...added.filter(id => stops.value.has(id) && !own.includes(id))]
    return previous && previous.length === next.length && previous.every((id, i) => id === next[i]) ? previous : next
  })
  // The stops picked, as added to and taken from the subject's own.
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
        operator: names(stopRoutes.map(r => r?.agency?.agency_name)),
        routes: names(stopRoutes.map(r => r?.route_short_name || r?.route_long_name)),
        platform: !!s.parent?.stop_id,
        routeIds: s.route_stops.map(rs => rs.route_id),
        lon: lon!,
        lat: lat!,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name)))
  // The routes at those stops, with their representative lines.
  const mapRoutes = computed(() => [...new Set(mapStops.value.flatMap(s => s.routeIds))]
    .map(id => routes.value.get(id))
    .filter(r => !!r?.geometry)
    .map(r => ({
      id: r!.id,
      name: r!.route_short_name || r!.route_long_name || r!.route_id,
      operator: r!.agency?.agency_name ?? '',
      color: r!.route_color || undefined,
      geometry: r!.geometry!,
    })))
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
  // Every pair of the stops, each asked for once. That grows as the square
  // of the stops: a large station's many platforms (40 make 780 pairs,
  // routed one by one on the street network) would call for asking only
  // pairs within a plausible walk.
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

  // How far the departures read reach: only the outer breakpoints and the
  // longest walk, so editing a grade's bounds or loading a distance under
  // the longest leaves the events be.
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

  // The date's arrivals, and the departures they can reach, which is all the
  // views show, so all the trip details fetched are for.
  const events = computed(() => {
    const r = result.value
    if (!r || stopIds.value.length === 0 || !individualDate.value) {
      return undefined
    }
    return transferEvents({
      stopIds: stopIds.value,
      dates: [individualDate.value],
      ...timeWindow.value,
      stopDepartureCache: r.stopDepartureCache,
      tripDetails: store.details.value,
      maxWalkSeconds: mostWalk.value,
      breakpoints: [missedReach.value, waitReach.value],
    })
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

  // The trips left out, each read through its own setting, so other
  // settings changing leave what follows them be.
  const excludedFromKeys = computed(() => settings.value.excludedFrom)
  const excludedToKeys = computed(() => settings.value.excludedTo)
  const excludedFrom = computed(() => new Set(excludedFromKeys.value))
  const excludedTo = computed(() => new Set(excludedToKeys.value))
  const arrivals = computed(() => (events.value?.arrivals ?? []).filter(a => !excludedFrom.value.has(transferTripKey(a))))

  // The date's arrivals and their connections, worked out for that date
  // alone. Departures left out are dropped after: each destination's first
  // connection stands apart from the others', so dropping some leaves the
  // rest as they were.
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
        allConnections: settings.value.allConnections,
        agencyOf: routeId => routes.value.get(routeId)?.agency?.id,
        countTurnbacks: settings.value.countTurnbacks,
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
  // Where arriving trips come from and departing ones go, around the middle
  // of the stops; and the connections by grade at each.
  const compass = computed(() => {
    const center = centerOf(stopIds.value.flatMap((id) => {
      const [lon, lat] = stops.value.get(id)?.geometry.coordinates ?? []
      return lon === undefined || lat === undefined ? [] : [[lon, lat] as [number, number]]
    }))
    return {
      from: center ? transferCompassPlaces(routeChoices.value.from, 'from', center) : [],
      to: center ? transferCompassPlaces(routeChoices.value.to, 'to', center) : [],
    }
  })
  const rose = computed(() => transferRose(summary.value, compass.value, tripInfo.value))

  // The views' rows, flat, as CSV: built when asked for.
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

  // While shown, the details of the trips the report is missing, and the
  // distances between its stops. Each widens what the other needs (a longer
  // walk reaches later departures), so both follow their own inputs. After a
  // failure, loading waits for a retry rather than asking again at once.
  // Each waits on its own failure, so one failing leaves the other loading.
  const detailsError = ref<string | null>(null)
  async function load (): Promise<void> {
    if (!toValue(deps.active) || stopIds.value.length === 0) {
      return
    }
    await Promise.all([
      distancesError.value ? undefined : loadDistances(),
      detailsError.value
        ? undefined
        : store.load(events.value?.missingTripIds ?? []).then((err) => {
            detailsError.value = err
          }),
    ])
  }
  function retry (): Promise<void> {
    detailsError.value = null
    distancesError.value = null
    return load()
  }
  // Nothing is read while hidden, so the report does no work then; each
  // source compared by value, so a recompute that changes nothing loads
  // nothing.
  const active = () => toValue(deps.active)
  watch(
    [active, () => (active() ? pairs.value : undefined), () => (active() ? distanceModes.value : undefined), () => (active() ? (events.value?.missingTripIds ?? []).join(',') : '')],
    () => load(),
  )

  // The subject by name, as the report's heading and download names; with
  // its count of stops where they have been changed.
  const title = computed(() => {
    const s = toValue(deps.subject)
    let name = ''
    if (s?.kind === 'stop') {
      const stop = stops.value.get(s.stopId)
      name = stop?.stop_name || stop?.stop_id || ''
    } else if (cluster.value) {
      name = clusterDisplayName(cluster.value.name, cluster.value.nearName)
    }
    const edited = deps.stopEdits.value.added.length > 0 || deps.stopEdits.value.removed.length > 0
    return edited ? `${name} (${stopIds.value.length} stops)` : name
  })

  // What the report can be about: the scenario's clusters, then its stops
  // with service, each by name.
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
    individualGrid,
    individualPoints,
    detailsLoading: computed(() => store.loading.value || distancesLoading.value > 0),
    detailsError: computed(() => detailsError.value ?? (distancesError.value ? `distances between stops: ${distancesError.value}` : null)),
    // Pairs of the stops with no distance to walk between them, which are
    // left out.
    unknownPairs: computed(() => (distancesLoading.value > 0 ? 0 : walkTable.value.unknown)),
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
