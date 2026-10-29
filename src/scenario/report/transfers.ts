// Transfers at a stop or stop cluster, graded by the wait after walking.
//
// Each trip arriving at the stops is paired with the trips leaving soon after
// on other routes. Times are absolute seconds (the service date's day number,
// `isoToOrdinal`, times 86400, plus the feed's GTFS seconds), so a departure
// past midnight compares correctly with an arrival the evening before.

import { TRANSFER_GRADE_BREAKPOINTS, TRANSFER_WALK_SECONDS_PER_METER, formatDuration, formatGtfsTimeFull, groupBy } from '../../core'
import type { StopDepartureCache } from '../../tl/departure-cache'
import { isoToOrdinal, ordinalToIso } from '../../tl/feed-version'
import { tripHeadsignAt, type TripDetail, type TripStopTime } from '../../tl/trip-details'
import { summarizeGaps } from '../route-headway'
import type { TripTableRoute, TripTableStop } from './subject-trips'

const SECONDS_PER_DAY = 86400
// The longest dwell assumed between arriving at a stop and leaving, as a
// ferry or long-distance train may wait.
const LONGEST_DWELL = 3600

// One trip's arrival at the subject's stops, where riders alight, or its
// departure, where riders board.
export interface TransferEvent {
  tripId: number
  routeId: number
  directionId: number
  stopId: number
  // The trip's GTFS service date (yyyy-MM-dd).
  serviceDate: string
  // Absolute seconds; see the module comment.
  time: number
  // The time's calendar date, and its seconds into that day.
  date: string
  seconds: number
  headsign?: string
  // Where the trip starts and ends, by station, and how many stops it makes.
  origin?: string
  terminus?: string
  // Where those stations are, as [lon, lat].
  originPoint?: [number, number]
  terminusPoint?: [number, number]
  // The first stop's own name and its station's.
  originNames?: string[]
  stopCount?: number
  // An arrival on a trip that ends at the stops, or a departure on one that
  // starts there.
  terminal?: boolean
  // The stations (stationId) of the trip's calls just before and just after
  // the stops, if any.
  prevStation?: number
  nextStation?: number
  // The calls on this visit to the stops where a rider could alight (an
  // arrival) or board (a departure), in time order, starting with the
  // event's own. A connection uses whichever pair of calls serves the rider
  // best.
  calls: TransferCall[]
}

// One call at the stops: the stop and its absolute time.
export interface TransferCall {
  stopId: number
  time: number
}

// A connection's grade, by its wait after walking.
export type TransferGrade = 'missed' | 'close' | 'acceptable' | 'unacceptable'

// In order of wait, shortest first.
export const TRANSFER_GRADES: readonly TransferGrade[] = ['missed', 'close', 'acceptable', 'unacceptable']

// Each grade's display name.
export const TRANSFER_GRADE_LABELS: Record<TransferGrade, string> = {
  missed: 'Missed',
  close: 'Close',
  acceptable: 'Acceptable',
  unacceptable: 'Unacceptable',
}

// Each grade's colors, from the Okabe-Ito palette: distinguishable with common
// forms of color blindness, and readable in light and dark themes. `text` is
// the color for text on `fill`.
export const TRANSFER_GRADE_COLORS: Record<TransferGrade, { fill: string, text: string }> = {
  missed: { fill: '#D55E00', text: '#1a1a1a' },
  close: { fill: '#0072B2', text: '#ffffff' },
  acceptable: { fill: '#56B4E9', text: '#1a1a1a' },
  unacceptable: { fill: '#E69F00', text: '#1a1a1a' },
}

// One connection: its departure, walk, wait, and grade.
export interface TransferConnection {
  // The departing trip, at the call where the rider boards.
  departure: TransferEvent
  // Set when the rider stays on the arriving trip to another of the stops:
  // the call where the rider alights.
  alight?: TransferCall
  walk: number
  // Seconds between arriving after the walk and the departure; negative for a
  // missed connection.
  wait: number
  grade: TransferGrade
  // Back the way the arrival came, or on its own way (see calculateTransfers).
  way?: TransferWay
}

// An arrival and its connections.
export interface TransferGroup {
  arrival: TransferEvent
  // By wait, shortest first.
  connections: TransferConnection[]
}

// How the Transfer Analyst finds and grades connections.
export interface TransferSettings {
  // Where a walk between two different stops gets its distance: a straight
  // line or the street network, from the Transitland directions API.
  walkDistance: 'line' | 'street'
  // Walking time per meter of that distance.
  secondsPerMeter: number
  // Every connection, rather than the first on each route, direction, and
  // destination.
  allConnections: boolean
  // Count connections back the way an arrival came or on its own way.
  countSameWay: boolean
  // Five increasing wait breakpoints, in seconds.
  breakpoints: number[]
  // Route, direction, and destination keys (transferTripKey) whose
  // arrivals, or departures, are left out.
  excludedFrom: string[]
  excludedTo: string[]
}

// The key for a trip's route, direction, and destination at the stops. The
// destination is the trip's sign there, exactly as written in the feed.
export function transferTripKey (e: Pick<TransferEvent, 'routeId' | 'directionId' | 'headsign'>): string {
  return `${e.routeId}|${e.directionId}|${e.headsign ?? ''}`
}

// Where a destination's trips most often start and end, and how many stops
// they make.
export interface TransferTripRun {
  origin?: string
  terminus?: string
  // Where those stations are, as [lon, lat].
  originPoint?: [number, number]
  terminusPoint?: [number, number]
  stopCount?: number
}

// A destination of a route and direction at the stops, with its trip counts
// and usual run.
export interface TransferTripDestination {
  key: string
  label: string
  // Its trips' sign, or the route's long name.
  sign: string
  count: number
  run: TransferTripRun
  // Labeled "From" its origin, as its trips all end at the stops, so no
  // separate origin shows.
  namedByOrigin: boolean
  // How many of its trips end at the stops (arriving) or start there
  // (departing).
  terminal: number
  // Its direction's main run, set when this destination's run makes fewer
  // stops between other ends.
  shortOf?: TransferTripRun
}

// A direction of a route at the stops, with its destinations.
export interface TransferTripDirection {
  directionId: number
  // The direction's name, such as "Toward X" or "From X"; see
  // transferTripChoices.
  label: string
  count: number
  destinations: TransferTripDestination[]
}

// A route at the stops, with its directions, their destinations, and trip
// counts.
export interface TransferRouteChoice {
  id: number
  label: string
  longName: string
  // The route's operator (its GTFS agency), by name.
  operator: string
  count: number
  directions: TransferTripDirection[]
}

// The route fields transferTripChoices reads.
export type TransferChoiceRoute = TripTableRoute & { route_sort_order?: number | null }

// The trips at the stops as a tree of routes, directions, and destinations.
//
// `side` says whether the trips arrive ('from') or depart ('to'). Routes go
// by their GTFS sort order, then name.
//
// A direction is named for where its trips go: "Toward X" when more than half
// of them are signed for X, or failing that end at X, or "Toward X or Y" when
// two cover more than half. Arriving trips that mostly end at the stops are
// named for their origin instead ("From X"), as their sign names the stops
// themselves. Where both directions would read the same, or nothing covers
// half, a direction is "Direction 0" or "Direction 1".
//
// A destination is its sign, or the route's long name; an arriving one whose
// trips all end at the stops is "From" its origin, and a departing one signed
// for where its trips start is named for where they end. Destinations that
// would read the same are told apart: across directions, by where each ends,
// else by direction; within one direction, by sign. A destination whose trips
// most often make fewer stops than its direction's busiest destination,
// between other ends, is a short run.
export function transferTripChoices (events: TransferEvent[], routes: Map<number, TransferChoiceRoute>, side: 'from' | 'to' = 'to'): TransferRouteChoice[] {
  const choices = [...groupBy(events, e => e.routeId)].map(([id, routeEvents]) => {
    const route = routes.get(id)
    const label = routeLabel(route) || String(id)
    const signLabel = (headsign: string) => headsign || route?.route_long_name || 'No destination'
    const directions = [...groupBy(routeEvents, e => e.directionId)].map(([directionId, directionEvents]) => {
      const destinations: TransferTripDestination[] = [...groupBy(directionEvents, e => e.headsign ?? '')]
        .map(([headsign, trips]) => {
          const origin = mostCommon(trips.flatMap(e => e.origin || []))
          const terminus = mostCommon(trips.flatMap(e => e.terminus || []))
          const run = {
            origin,
            terminus,
            originPoint: stationPoint(trips, origin),
            terminusPoint: stationPoint(trips, terminus),
            stopCount: mostCommon(trips.flatMap(e => e.stopCount ?? [])),
          }
          const terminal = trips.filter(e => e.terminal).length
          const namedByOrigin = side === 'from' && terminal === trips.length && !!run.origin
          // A departing trip signed for where it starts says nothing of where
          // it goes, so goes by where it ends.
          const signedForStart = side === 'to' && !!run.terminus && run.terminus !== run.origin && (headsign === run.origin || trips.some(e => e.originNames?.includes(headsign)))
          return {
            key: transferTripKey({ routeId: id, directionId, headsign }),
            sign: signLabel(headsign),
            label: namedByOrigin ? `From ${run.origin}` : signedForStart ? run.terminus! : signLabel(headsign),
            namedByOrigin,
            count: trips.length,
            run,
            terminal,
          }
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      const main = destinations[0]?.run
      for (const d of destinations.slice(1)) {
        if (main && isShorter(d.run, main)) {
          d.shortOf = main
        }
      }
      const count = directionEvents.length
      const terminal = directionEvents.filter(e => e.terminal).length
      const signs = new Map<string, number>()
      for (const d of destinations) {
        // A departing destination counts under its label, which replaces a
        // sign naming where its trips start.
        const named = side === 'to' ? d.label : d.sign
        signs.set(named, (signs.get(named) || 0) + d.count)
      }
      const byEnd = mainOf(countsOf(directionEvents.flatMap(e => e.terminus || [])), count)
      const name = side === 'from' && terminal * 2 > count
        ? prefixed('From', mainOf(countsOf(directionEvents.flatMap(e => e.origin || [])), count))
        : prefixed('Toward', mainOf(signs, count) ?? byEnd)
      return {
        directionId,
        name,
        byEnd: prefixed('Toward', byEnd),
        count,
        destinations,
      }
    }).sort((a, b) => a.directionId - b.directionId)
    // Names that tell the directions apart: by sign, else by where they end.
    const distinct = (names: (string | undefined)[]) => names.length < 2 || names[0] !== names[1]
    let names = directions.map(d => d.name)
    if (!distinct(names)) {
      names = directions.map(d => d.byEnd)
    }
    if (!distinct(names)) {
      names = directions.map(() => undefined)
    }
    const labeled = directions.map(({ directionId, count, destinations }, i) => ({
      directionId,
      label: names[i] ?? `Direction ${directionId}`,
      count,
      destinations,
    }))
    // Destinations that would read the same, told apart.
    const all = labeled.flatMap(d => d.destinations.map(x => ({ x, direction: d })))
    const renamed = all.map(({ x, direction }) => {
      const same = all.filter(o => o.x.label === x.label)
      if (same.length < 2) {
        return x.label
      }
      if (same.some(o => o.direction !== direction)) {
        const ends = same.map(o => o.x.namedByOrigin ? '' : o.x.run.terminus ?? '')
        return ends.every(Boolean) && new Set(ends).size === ends.length ? x.run.terminus! : `${x.label} (${direction.label})`
      }
      return `${x.label} (${x.sign})`
    })
    all.forEach(({ x }, i) => {
      x.label = renamed[i]!
    })
    return {
      id,
      label,
      longName: route?.route_long_name ?? '',
      operator: route?.agency_name ?? '',
      count: labeled.reduce((n, d) => n + d.count, 0),
      directions: labeled,
    }
  })
  const sortOrder = (id: number) => routes.get(id)?.route_sort_order ?? Number.POSITIVE_INFINITY
  return choices.sort((a, b) => sortOrder(a.id) - sortOrder(b.id) || a.label.localeCompare(b.label, undefined, { numeric: true }))
}

function countsOf<T extends string | number> (values: T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  return counts
}

// What covers more than half of `total`: one value, or the top two ("X or Y").
function mainOf (counts: Map<string, number>, total: number): string | undefined {
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1])
  if (first && first[1] * 2 > total) {
    return first[0]
  }
  return first && second && (first[1] + second[1]) * 2 > total ? `${first[0]} or ${second[0]}` : undefined
}

function prefixed (prefix: string, name: string | undefined): string | undefined {
  return name ? `${prefix} ${name}` : undefined
}

// Whether a run makes fewer stops than another, between other ends.
function isShorter (run: TransferTripRun, than: TransferTripRun): boolean {
  return run.stopCount !== undefined && than.stopCount !== undefined && run.stopCount < than.stopCount
    && (run.origin !== than.origin || run.terminus !== than.terminus)
}

// Every destination of the choices, route by route.
export function choiceDestinations (choices: TransferRouteChoice[]): TransferTripDestination[] {
  return choices.flatMap(r => r.directions.flatMap(d => d.destinations))
}

// Each destination of the choices by its key.
export function transferTripInfo (choices: TransferRouteChoice[]): Map<string, TransferTripDestination> {
  return new Map(choiceDestinations(choices).map(x => [x.key, x]))
}

// A note on a trip: it ends (or starts) at the stops, is a short run, or goes
// back the way the arrival came or on its way. `label` names the note and
// `title` gives it in full; `partial` marks a note true of only some of the
// trips.
export interface TransferTripTag {
  kind: 'ends' | 'starts' | 'short' | 'back' | 'same'
  partial?: boolean
  label: string
  title: string
}

function runText (run: TransferTripRun): string {
  const ends = run.origin && run.terminus ? `${run.origin} to ${run.terminus}` : run.origin || run.terminus || ''
  const stops = run.stopCount !== undefined ? `${run.stopCount} stops` : ''
  return [ends, stops].filter(Boolean).join(', ')
}

const TERMINAL_TEXT: Record<'from' | 'to', { kind: TransferTripTag['kind'], all: string, some: string, trips: string, trip: string, so: (them: string) => string }> = {
  from: { kind: 'ends', all: 'Ends here', some: 'Some end here', trips: 'end', trip: 'ends', so: () => 'every rider gets off here' },
  to: { kind: 'starts', all: 'Starts here', some: 'Some start here', trips: 'start', trip: 'starts', so: them => `no one rides in on ${them}` },
}

// The tags for a destination's trips, arriving ('from') or departing ('to'):
// whether all or some end or start at the stops, and whether they are a short
// run. For one trip, `terminal` says whether that trip ends or starts there.
export function transferTripTags (d: TransferTripDestination | undefined, side: 'from' | 'to', terminal?: boolean): TransferTripTag[] {
  const text = TERMINAL_TEXT[side]
  const tags: TransferTripTag[] = []
  if (terminal) {
    tags.push({ kind: text.kind, label: text.all, title: `This trip ${text.trip} at the stops, so ${text.so('it')}.` })
  } else if (terminal === undefined && d && d.terminal > 0) {
    tags.push(d.terminal === d.count
      ? { kind: text.kind, label: text.all, title: `These trips ${text.trips} at the stops, so ${text.so('them')}.` }
      : { kind: text.kind, partial: true, label: text.some, title: `${d.terminal.toLocaleString()} of ${d.count.toLocaleString()} of these trips ${text.trips} at the stops.` })
  }
  if (d?.shortOf) {
    tags.push({ kind: 'short', label: 'Short run', title: `Runs ${runText(d.run)}; most trips this way run ${runText(d.shortOf)}.` })
  }
  return tags
}

// The settings before any change; a link carries only those that differ.
export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  walkDistance: 'line',
  secondsPerMeter: TRANSFER_WALK_SECONDS_PER_METER,
  allConnections: false,
  countSameWay: false,
  breakpoints: [...TRANSFER_GRADE_BREAKPOINTS],
  excludedFrom: [],
  excludedTo: [],
}

// The settings that differ from the defaults, as JSON for a link; none
// where all are the defaults.
export function encodeTransferSettings (settings: TransferSettings): string | undefined {
  const diff: Partial<TransferSettings> = {}
  for (const key of Object.keys(DEFAULT_TRANSFER_SETTINGS) as (keyof TransferSettings)[]) {
    if (JSON.stringify(settings[key]) !== JSON.stringify(DEFAULT_TRANSFER_SETTINGS[key])) {
      Object.assign(diff, { [key]: settings[key] })
    }
  }
  return Object.keys(diff).length > 0 ? JSON.stringify(diff) : undefined
}

// Settings from a link's JSON, over the defaults; a setting with an invalid
// value keeps its default.
export function decodeTransferSettings (json: string | undefined): TransferSettings {
  const out: TransferSettings = { ...DEFAULT_TRANSFER_SETTINGS, breakpoints: [...DEFAULT_TRANSFER_SETTINGS.breakpoints] }
  let raw: Record<string, unknown>
  try {
    raw = json ? JSON.parse(json) : {}
  } catch {
    return out
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return out
  }
  const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string')
  if (raw.walkDistance === 'line' || raw.walkDistance === 'street') {
    out.walkDistance = raw.walkDistance
  }
  if (typeof raw.secondsPerMeter === 'number' && raw.secondsPerMeter >= 0) {
    out.secondsPerMeter = raw.secondsPerMeter
  }
  if (typeof raw.allConnections === 'boolean') {
    out.allConnections = raw.allConnections
  }
  if (typeof raw.countSameWay === 'boolean') {
    out.countSameWay = raw.countSameWay
  }
  if (Array.isArray(raw.breakpoints) && raw.breakpoints.every(b => typeof b === 'number') && validBreakpoints(raw.breakpoints as number[])) {
    out.breakpoints = raw.breakpoints as number[]
  }
  if (strings(raw.excludedFrom)) {
    out.excludedFrom = raw.excludedFrom as string[]
  }
  if (strings(raw.excludedTo)) {
    out.excludedTo = raw.excludedTo as string[]
  }
  return out
}

// Whether breakpoints can grade waits: five, strictly increasing.
export function validBreakpoints (breakpoints: readonly number[]): boolean {
  return breakpoints.length === 5 && breakpoints.every((b, i) => Number.isFinite(b) && (i === 0 || b > breakpoints[i - 1]!))
}

// How calculateTransfers measures walks, grades waits, and keeps connections.
export interface TransferOptions {
  // Walking time between two stops, in seconds; not finite where it is not
  // known, which leaves that pair of stops out.
  walkSeconds: (fromStopId: number, toStopId: number) => number
  // The most walkSeconds returns, to bound the search.
  maxWalkSeconds: number
  // Five increasing wait breakpoints, in seconds: missed, close, acceptable,
  // and unacceptable fall between consecutive pairs.
  breakpoints: readonly number[]
  // Every connection, rather than the first made on each route, direction,
  // and destination, and any earlier missed ones.
  allConnections?: boolean
  // Whether to count connections back the way an arrival came or on its own
  // way.
  countSameWay?: boolean
}

// An absolute time's calendar date, and its seconds into that day.
export function calendarTime (time: number): { date: string, seconds: number } {
  const day = Math.floor(time / SECONDS_PER_DAY)
  return { date: ordinalToIso(day), seconds: time - day * SECONDS_PER_DAY }
}

// A wait's grade by the breakpoints, each grade including its lower bound.
export function transferGrade (wait: number, breakpoints: readonly number[] = TRANSFER_GRADE_BREAKPOINTS): TransferGrade {
  if (wait < breakpoints[1]!) {
    return 'missed'
  }
  if (wait < breakpoints[2]!) {
    return 'close'
  }
  if (wait < breakpoints[3]!) {
    return 'acceptable'
  }
  return 'unacceptable'
}

// Inputs to transferEvents.
export interface TransferEventsOptions {
  stopIds: number[]
  // The calendar date (yyyy-MM-dd) whose arrivals count.
  date: string
  // The time-of-day window for arrivals, in seconds.
  startTime: number
  endTime: number
  stopDepartureCache: StopDepartureCache
  tripDetails: Map<number, TripDetail>
  // The longest walk, and the earliest and latest waits, which bound how
  // early and late a departure can connect.
  maxWalkSeconds: number
  minWait: number
  maxWait: number
}

// The arrivals and departures at the stops, and the trips still missing
// details.
export interface TransferEvents {
  arrivals: TransferEvent[]
  departures: TransferEvent[]
  // Trips the transfers need whose details have not arrived, so are left out
  // until they do.
  missingTripIds: number[]
}

interface TripCall {
  stopTime: TripStopTime
  // The index of the first call in this call's visit to the stops: a run of
  // calls in a row at the stops, which a trip passing the stops twice makes
  // twice.
  visit: number
  // Whether the trip calls elsewhere before and after the visit.
  comesFrom: boolean
  goesOn: boolean
  // The stations of its calls just before and just after the visit.
  prevStation?: number
  nextStation?: number
  // The trip's headsign at this stop.
  headsign?: string
}

// A trip's call at a stop, with its visit to the stops. Where the trip calls
// there more than once, the call nearest the departure wins, as a call may
// lack its own departure time in the details.
function findCall (detail: TripDetail, stopId: number, departureTime: number, atStops: Set<number>): TripCall | null {
  const stopTimes = detail.stopTimes
  let index = -1
  for (let i = 0; i < stopTimes.length; i++) {
    const s = stopTimes[i]!
    if (s.stopId === stopId && (index < 0 || Math.abs((s.departure ?? Infinity) - departureTime) < Math.abs((stopTimes[index]!.departure ?? Infinity) - departureTime))) {
      index = i
    }
  }
  const stopTime = stopTimes[index]
  if (!stopTime) {
    return null
  }
  let first = index
  while (first > 0 && atStops.has(stopTimes[first - 1]!.stopId)) {
    first--
  }
  let last = index
  while (last < stopTimes.length - 1 && atStops.has(stopTimes[last + 1]!.stopId)) {
    last++
  }
  const prev = stopTimes[first - 1]
  const next = stopTimes[last + 1]
  const station = (s: TripStopTime | undefined) => s?.stationId
  return { stopTime, visit: first, comesFrom: !!prev, goesOn: !!next, prevStation: station(prev), nextStation: station(next), headsign: tripHeadsignAt(detail, stopId) }
}

// Adds a call to its visit's event, which keeps the visit's first call.
function addCall (events: Map<string, TransferEvent>, key: string, e: Omit<TransferEvent, 'calls'>) {
  const seen = events.get(key)
  const call = { stopId: e.stopId, time: e.time }
  if (!seen) {
    events.set(key, { ...e, calls: [call] })
  } else if (!seen.calls.some(c => c.stopId === call.stopId && c.time === call.time)) {
    const calls = [...seen.calls, call].sort((a, b) => a.time - b.time)
    events.set(key, call.time < seen.time ? { ...e, calls } : { ...seen, calls })
  }
}

// The arrivals and departures at a subject's stops.
//
// A trip arrives where it lets riders off, coming from somewhere else, and
// departs where it picks them up, going on somewhere else; a trip moving only
// between the stops does neither. A trip calling at several of the stops in a
// row makes one arrival and one departure at its first call, listing every
// call a rider could use; a trip that leaves the stops and comes back makes
// one of each per visit.
export function transferEvents (opts: TransferEventsOptions): TransferEvents {
  const arrivals = new Map<string, TransferEvent>()
  const departures = new Map<string, TransferEvent>()
  const missing = new Set<number>()
  const atStops = new Set(opts.stopIds)
  // The departures that can matter.
  //
  // They run from the window's start, less how far back a missed connection
  // reaches, to its end plus the longest walk and wait, or the longest dwell
  // if longer, as departures are read by when a trip leaves the stop. A
  // departure early in a day may connect from an arrival late the day before,
  // so it is also read as a day later; one late in a day may be missed by an
  // arrival just after midnight, so it is also read as a day earlier.
  const from = opts.startTime + Math.min(0, opts.minWait)
  const until = opts.endTime + Math.max(opts.maxWalkSeconds + opts.maxWait, LONGEST_DWELL)
  const inReach = (t: number) => t >= from && t <= until
  const crossesMidnight = (t: number) => inReach(t + SECONDS_PER_DAY) || inReach(t - SECONDS_PER_DAY)
  // The date, whose departures all count, and the days either side, read
  // only for those across midnight.
  const target = isoToOrdinal(opts.date)
  for (const [day, acrossMidnightOnly] of [[target - 1, true], [target, false], [target + 1, true]] as const) {
    const date = ordinalToIso(day)
    for (const stopId of opts.stopIds) {
      for (const st of opts.stopDepartureCache.get(stopId, date)) {
        const t = st.departureTime % SECONDS_PER_DAY
        if (!(crossesMidnight(t) || (!acrossMidnightOnly && inReach(t)))) {
          continue
        }
        const detail = opts.tripDetails.get(st.tripId)
        if (!detail) {
          missing.add(st.tripId)
          continue
        }
        const call = findCall(detail, stopId, st.departureTime, atStops)
        if (!call) {
          continue
        }
        const { stopTime, visit, comesFrom, goesOn, headsign, prevStation, nextStation } = call
        const serviceDay = day - Math.floor(st.departureTime / SECONDS_PER_DAY)
        const serviceDate = ordinalToIso(serviceDay)
        const base = serviceDay * SECONDS_PER_DAY
        // One run of the trip: a trip from frequencies.txt runs many times a
        // day under one id, each run offset from its stated times.
        const runOffset = st.departureTime - (stopTime.departure ?? st.departureTime)
        const key = `${st.tripId}|${serviceDate}|${runOffset}|${visit}`
        const event = (time: number): Omit<TransferEvent, 'calls'> => ({
          tripId: st.tripId,
          routeId: st.routeId,
          directionId: st.directionId,
          stopId,
          serviceDate,
          time,
          ...calendarTime(time),
          headsign,
          origin: detail.firstStopName,
          terminus: detail.lastStopName,
          originPoint: detail.firstStopPoint,
          originNames: detail.firstStopNames,
          terminusPoint: detail.lastStopPoint,
          stopCount: detail.stopCount,
          prevStation,
          nextStation,
        })
        if (comesFrom && stopTime.dropOffType !== 1) {
          const dwell = stopTime.arrival !== undefined && stopTime.departure !== undefined ? stopTime.departure - stopTime.arrival : 0
          const time = base + st.departureTime - Math.max(0, dwell)
          addCall(arrivals, key, { ...event(time), terminal: !goesOn })
        }
        if (goesOn && (st.pickupType ?? stopTime.pickupType) !== 1) {
          addCall(departures, key, { ...event(base + st.departureTime), terminal: !comesFrom })
        }
      }
    }
  }
  // Arrivals on the date and in the window; departures at any time, as a
  // connection may leave after the window ends.
  const inWindow = (e: TransferEvent) => e.date === opts.date && e.seconds >= opts.startTime && e.seconds <= opts.endTime
  return {
    arrivals: [...arrivals.values()].filter(inWindow).sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    departures: [...departures.values()].sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    missingTripIds: [...missing],
  }
}

// A departure along an arrival's way, which is not a change a rider needs.
//
// 'back' calls next at the arrival's previous station, as a vehicle turning
// back or the line the other way does. 'same' calls next at the arrival's
// next station, as another line along the same track does.
export type TransferWay = 'back' | 'same'

function sharedWay (arrival: TransferEvent, departure: TransferEvent): TransferWay | undefined {
  const next = departure.nextStation
  if (next === undefined) {
    return undefined
  }
  return next === arrival.prevStation ? 'back' : next === arrival.nextStation ? 'same' : undefined
}

// The calls to leave one trip and board another that serve a rider best.
//
// Of the connections made, the earliest boarding wins, leaving at the
// earliest call that still makes the connection: riding on past a stop to
// walk back gives no shorter a transfer. With none made, the connection
// missed by the least wins. None where no pair falls within the waits.
function bestCalls (alights: TransferCall[], boards: TransferCall[], walkSeconds: (from: number, to: number) => number, minWait: number, maxWait: number) {
  let best: { alight: TransferCall, board: TransferCall, walk: number, wait: number } | undefined
  for (const alight of alights) {
    for (const board of boards) {
      const walk = walkSeconds(alight.stopId, board.stopId)
      if (!Number.isFinite(walk)) {
        continue
      }
      const wait = board.time - alight.time - walk
      if (wait < minWait || wait > maxWait) {
        continue
      }
      const better = !best || (wait >= 0
        ? best.wait < 0 || board.time < best.board.time || (board.time === best.board.time && alight.time < best.alight.time)
        : best.wait < 0 && wait > best.wait)
      if (better) {
        best = { alight, board, walk, wait }
      }
    }
  }
  return best
}

// The first index in sorted events at or after time.
function lowerBound (events: TransferEvent[], time: number): number {
  let lo = 0
  let hi = events.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid]!.time < time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// Each arrival's connections: departures on another route whose wait after
// walking falls within the breakpoints.
//
// The same route in either direction is not a transfer: in the other
// direction it is often the same vehicle turning back at the end of its run.
// Unless `allConnections`, each route, direction, and destination keeps the
// first connection a rider makes (the earliest departure, not the shortest
// wait) and any missed ahead of that one, as riders do not transfer to later
// departures. A short run counts apart from the full run, as a short run may
// not go where a rider is headed.
//
// Departures back the way an arrival came, or on along its way (TransferWay),
// are not changes a rider needs, as where a feed models each direction as its
// own route or two lines share a track. They are left out unless
// `countSameWay`, and marked when counted.
export function calculateTransfers (arrivals: TransferEvent[], departures: TransferEvent[], opts: TransferOptions): TransferGroup[] {
  const bp = opts.breakpoints
  const minWait = bp[0]!
  const maxWait = bp[bp.length - 1]!
  // How long the longest visit's calls run past its first, so the search
  // for departures starts early enough to reach a later call on one.
  const span = departures.reduce((most, d) => Math.max(most, d.calls.at(-1)!.time - d.time), 0)
  return arrivals.map((arrival) => {
    const connections: TransferConnection[] = []
    const alights = arrival.calls
    const last = alights[alights.length - 1]!.time + opts.maxWalkSeconds + maxWait
    // Departures come sorted by their first call's time, as transferEvents
    // gives them.
    for (let i = lowerBound(departures, arrival.time + minWait - span); i < departures.length && departures[i]!.time <= last; i++) {
      const departure = departures[i]!
      // Skip the same route in either direction, which includes the same
      // trip, and any departure whose last call leaves too early to connect
      // (the search's early start reaches some).
      if (departure.routeId === arrival.routeId || departure.calls.at(-1)!.time < arrival.time + minWait) {
        continue
      }
      const best = bestCalls(alights, departure.calls, opts.walkSeconds, minWait, maxWait)
      if (!best) {
        continue
      }
      const way = sharedWay(arrival, departure)
      if (way && !opts.countSameWay) {
        continue
      }
      const { alight, board, walk, wait } = best
      connections.push({
        departure: board.stopId === departure.stopId && board.time === departure.time ? departure : { ...departure, ...board, ...calendarTime(board.time) },
        ...(alight.stopId !== arrival.stopId || alight.time !== arrival.time ? { alight } : {}),
        walk,
        wait,
        grade: transferGrade(wait, bp),
        ...(way ? { way } : {}),
      })
    }
    // Sort by the boarding call's time: a destination's first connection made
    // is the earliest departure a rider can take, which may have the longer
    // wait when its stop is nearer.
    const made = new Set<string>()
    const kept = opts.allConnections
      ? connections
      : connections.sort((a, b) => a.departure.time - b.departure.time).filter((c) => {
          const key = transferTripKey(c.departure)
          if (made.has(key)) {
            return false
          }
          if (c.grade !== 'missed') {
            made.add(key)
          }
          return true
        })
    return { arrival, connections: kept.sort((a, b) => a.wait - b.wait || a.departure.routeId - b.departure.routeId) }
  })
}

// How many connections have a grade, and their share of all connections.
export interface TransferGradeCount {
  grade: TransferGrade
  count: number
  share: number
}

// The figures over a set of arrivals.
export interface TransferOverview {
  arrivals: number
  connections: number
  // Connections by grade, in order of wait.
  grades: TransferGradeCount[]
  // The share of arrivals whose soonest connection made, on any route, is
  // close or acceptable, then the close and acceptable shares on their own.
  closeOrAcceptableShare: number
  closeShare: number
  acceptableShare: number
  // The median wait for each arrival's soonest connection made, over arrivals
  // that make one.
  medianWait?: number
}

// Connections by departure, earliest first; by wait where two leave at once.
function inDepartureOrder (connections: TransferConnection[]): TransferConnection[] {
  return [...connections].sort((a, b) => a.departure.time - b.departure.time || a.wait - b.wait)
}

// The figures over all of the groups' arrivals.
export function transferOverview (groups: TransferGroup[]): TransferOverview {
  const counts: Record<TransferGrade, number> = { missed: 0, close: 0, acceptable: 0, unacceptable: 0 }
  let connections = 0
  let close = 0
  let acceptable = 0
  const waits: number[] = []
  for (const g of groups) {
    for (const c of g.connections) {
      counts[c.grade] += 1
    }
    connections += g.connections.length
    // The soonest made (not missed) is the earliest departure a rider can
    // take, which from a nearer stop may have the longer wait.
    const soonest = inDepartureOrder(g.connections).find(c => c.grade !== 'missed')
    if (soonest) {
      waits.push(soonest.wait)
      close += soonest.grade === 'close' ? 1 : 0
      acceptable += soonest.grade === 'acceptable' ? 1 : 0
    }
  }
  return {
    arrivals: groups.length,
    connections,
    grades: TRANSFER_GRADES.map(grade => ({ grade, count: counts[grade], share: connections > 0 ? counts[grade] / connections : 0 })),
    closeOrAcceptableShare: groups.length > 0 ? (close + acceptable) / groups.length : 0,
    closeShare: groups.length > 0 ? close / groups.length : 0,
    acceptableShare: groups.length > 0 ? acceptable / groups.length : 0,
    medianWait: summarizeGaps(waits)?.median,
  }
}

// The most common of some values.
function mostCommon<T extends string | number> (values: T[]): T | undefined {
  let best: T | undefined
  let bestCount = 0
  for (const [v, n] of countsOf(values)) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}

// The first point some trips give for a station, by name, as an origin or a
// terminus.
function stationPoint (trips: TransferEvent[], name: string | undefined): [number, number] | undefined {
  if (name === undefined) {
    return undefined
  }
  for (const e of trips) {
    if (e.origin === name && e.originPoint) {
      return e.originPoint
    }
    if (e.terminus === name && e.terminusPoint) {
      return e.terminusPoint
    }
  }
  return undefined
}

// One trip's route, direction, and destination (transferTripKey).
export interface TransferTripRef {
  key: string
  routeId: number
  directionId: number
  headsign?: string
}

function tripRef (e: TransferEvent): TransferTripRef {
  return { key: transferTripKey(e), routeId: e.routeId, directionId: e.directionId, headsign: e.headsign }
}

// Connections from one arriving destination to one departing one.
export interface TransferPairSummary {
  to: TransferTripRef
  // The figures over every arrival on the arriving destination, counting
  // only connections to the departing one.
  overview: TransferOverview
  // How many connections go back the way the arrival came or on its way,
  // when counted; `way` is set when all of them go one way.
  sameWay: number
  way?: TransferWay
}

// An arriving destination: its figures over all of its arrivals, as the
// overview's, and its connections by departing destination.
export interface TransferArrivalSummary {
  from: TransferTripRef
  overview: TransferOverview
  pairs: TransferPairSummary[]
}

// The arriving destinations (transferTripKey) of a Summary row or the
// Compass, and optionally departing ones, that narrow the trip filters.
export interface TransferFocus {
  from: string[]
  to?: string[]
}

type TransferExclusions = Pick<TransferSettings, 'excludedFrom' | 'excludedTo'>

// The trip filters narrowed to a focus.
//
// Every arriving destination outside the focus is left out too, and, where
// the focus names departing ones, so is every departing one outside those.
// Arriving and departing trips are filtered separately, so a focus of several
// pairs keeps any pair among them.
export function focusFilters (focus: TransferFocus, choices: { from: TransferRouteChoice[], to: TransferRouteChoice[] }, current: TransferExclusions): TransferExclusions {
  const keys = (routes: TransferRouteChoice[]) => choiceDestinations(routes).map(x => x.key)
  const outside = (all: string[], kept: string[], excluded: string[]) => {
    const keep = new Set(kept)
    return [...new Set([...excluded, ...all.filter(k => !keep.has(k))])]
  }
  return {
    excludedFrom: outside(keys(choices.from), focus.from, current.excludedFrom),
    excludedTo: focus.to ? outside(keys(choices.to), focus.to, current.excludedTo) : current.excludedTo,
  }
}

// How many connections in an overview were made, not missed.
function madeCount (o: TransferOverview): number {
  return o.connections - o.grades.find(g => g.grade === 'missed')!.count
}

// Connections totaled by arriving destination (route, direction, and sign),
// and under each, by departing destination.
//
// A pair's shares are of every arrival on its arriving destination, connected
// or not. Arriving destinations go by most arrivals; departing ones, by most
// connections made.
export function summarizeTransfers (groups: TransferGroup[]): TransferArrivalSummary[] {
  return [...groupBy(groups, g => transferTripKey(g.arrival)).values()].map((fromGroups) => {
    const connections = fromGroups.flatMap(g => g.connections)
    const pairs = [...groupBy(connections, c => transferTripKey(c.departure))].map(([key, list]): TransferPairSummary => {
      const ways = list.flatMap(c => c.way ?? [])
      return {
        to: tripRef(list[0]!.departure),
        overview: transferOverview(fromGroups.map(g => ({ arrival: g.arrival, connections: g.connections.filter(c => transferTripKey(c.departure) === key) }))),
        sameWay: ways.length,
        way: ways.length > 0 && ways.every(w => w === ways[0]) ? ways[0] : undefined,
      }
    })
    return {
      from: tripRef(fromGroups[0]!.arrival),
      overview: transferOverview(fromGroups),
      pairs: pairs.sort((a, b) => madeCount(b.overview) - madeCount(a.overview) || a.to.key.localeCompare(b.to.key)),
    }
  }).sort((a, b) => b.overview.arrivals - a.overview.arrivals || a.from.key.localeCompare(b.from.key))
}

// A wait or walk with its units, signed when missed: "4m 30s", "-1m 15s".
// Not "4:30", which reads as a time of day.
export function formatWait (seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  return seconds < 0 ? `-${formatDuration(-seconds)}` : formatDuration(seconds)
}

// A route's short name, else its long name or GTFS id.
export function routeLabel (route: Pick<TripTableRoute, 'route_id' | 'route_short_name' | 'route_long_name'> | undefined): string {
  return route?.route_short_name || route?.route_long_name || route?.route_id || ''
}

// The Summary as CSV records: one per pair of arriving and departing
// destinations, and one per arriving destination with none.
export interface TransferSummaryRow {
  from_route_id: string
  from_route_name: string
  from_route_color: string
  from_route_text_color: string
  from_agency_name: string
  from_direction_id: number
  from_headsign: string
  to_route_id: string
  to_route_name: string
  to_route_color: string
  to_route_text_color: string
  to_agency_name: string
  // Blank, with the other to_ columns, for an arriving destination with no
  // connections.
  to_direction_id: number | ''
  to_headsign: string
  arrivals: number
  missed: number
  close: number
  acceptable: number
  unacceptable: number
  close_or_acceptable_share: number
  // The close and acceptable parts of close_or_acceptable_share, in percent.
  close_share: number
  acceptable_share: number
  // Seconds; blank where no arrival makes a connection.
  median_wait_seconds: number | ''
}

function percent (share: number): number {
  return Math.round(share * 1000) / 10
}

// An overview's figures as table columns: connections by grade, then the
// shares in percent.
function figureColumns (o: TransferOverview) {
  const count = (grade: TransferGrade) => o.grades.find(g => g.grade === grade)!.count
  return {
    missed: count('missed'),
    close: count('close'),
    acceptable: count('acceptable'),
    unacceptable: count('unacceptable'),
    close_or_acceptable_share: percent(o.closeOrAcceptableShare),
    close_share: percent(o.closeShare),
    acceptable_share: percent(o.acceptableShare),
  }
}

type Side = 'from' | 'to'
type RouteColumns<P extends Side> = Record<`${P}_route_id` | `${P}_route_name` | `${P}_route_color` | `${P}_route_text_color` | `${P}_agency_name`, string>
type StopColumns<P extends Side> = Record<`${P}_stop_id` | `${P}_stop_name`, string>

// A side's route, as CSV columns; blank without one.
function routeColumns<P extends Side> (side: P, route: TripTableRoute | undefined): RouteColumns<P> {
  return {
    [`${side}_route_id`]: route?.route_id ?? '',
    [`${side}_route_name`]: routeLabel(route),
    [`${side}_route_color`]: route?.route_color ?? '',
    [`${side}_route_text_color`]: route?.route_text_color ?? '',
    [`${side}_agency_name`]: route?.agency_name ?? '',
  } as RouteColumns<P>
}

// A side's stop, as CSV columns; blank without one.
function stopColumns<P extends Side> (side: P, stop: TripTableStop | undefined): StopColumns<P> {
  return {
    [`${side}_stop_id`]: stop?.stop_id ?? '',
    [`${side}_stop_name`]: stop?.stop_name ?? '',
  } as StopColumns<P>
}

// A row per pair of arriving and departing destinations, for the CSV; and one
// for an arriving destination with none.
export function transferSummaryRows (summaries: TransferArrivalSummary[], routes: Map<number, TripTableRoute>): TransferSummaryRow[] {
  return summaries.flatMap(({ from: f, overview, pairs }) => {
    const from = routeColumns('from', routes.get(f.routeId))
    // An arriving destination with no connections gets one row with no
    // departing side, matching the Summary.
    return (pairs.length > 0 ? pairs : [undefined]).map((s): TransferSummaryRow => ({
      ...from,
      from_direction_id: f.directionId,
      from_headsign: f.headsign ?? '',
      ...routeColumns('to', s && routes.get(s.to.routeId)),
      to_direction_id: s?.to.directionId ?? '',
      to_headsign: s ? (s.to.headsign ?? '') : '',
      arrivals: overview.arrivals,
      ...figureColumns(s?.overview ?? transferOverview([])),
      median_wait_seconds: s?.overview.medianWait === undefined ? '' : Math.round(s.overview.medianWait),
    }))
  })
}

// A row of the report's nested tables: an arriving trip (or destination)
// heading its group, or a departing one beneath the heading. Rows share their
// trip columns, so the grid sorts a group's heading and its rows alike.
export interface TransferGridTrip {
  id: string
  // The heading row's id, for every row of its group.
  group: string
  head: boolean
  route_name: string
  agency_name: string
  // The destination's label from transferTripChoices: its sign, the route's
  // long name, or its origin or terminus.
  headsign: string
  // Its trips' sign.
  sign: string
  // An arriving trip's origin.
  origin: string
  tags: TransferTripTag[]
}

// A row of the Summary table.
export interface TransferSummaryGridRow extends TransferGridTrip {
  // On the heading row only.
  arrivals: number | ''
  missed: number
  close: number
  acceptable: number
  unacceptable: number
  // Percent.
  close_or_acceptable_share: number
  close_share: number
  acceptable_share: number
  median_wait_seconds: number | ''
}

// A row of the Individual table.
export interface TransferGridRow extends TransferGridTrip {
  // HH:MM:SS: the arrival on a heading row, else the departure.
  time: string
  stop_name: string
  walk_seconds: number | ''
  wait_seconds: number | ''
  // Blank on a heading row.
  grade: TransferGrade | ''
  grade_label: string
}

interface GridTripOptions {
  routes: Map<number, TripTableRoute>
  // The destinations at the stops (transferTripInfo), arriving and departing.
  from: Map<string, TransferTripDestination>
  to: Map<string, TransferTripDestination>
}

const SAME_WAY_TAGS: Record<TransferWay | 'both', { kind: TransferTripTag['kind'], label: string, text: string }> = {
  back: { kind: 'back', label: 'Back the way it came', text: 'back the way the arriving trip came' },
  same: { kind: 'same', label: 'Same way', text: 'on the way the arriving trip goes' },
  both: { kind: 'back', label: 'Back or same way', text: 'back the way the arriving trip came, or on its way' },
}

// The tag for connections back the way the arrival came or on its own way;
// without a way, some of each.
function sameWayTag (way: TransferWay | undefined, count: number, of: number): TransferTripTag {
  const { kind, label, text } = SAME_WAY_TAGS[way ?? 'both']
  return {
    kind,
    partial: count < of,
    label,
    title: of === 1 ? `It goes ${text}: not a change a rider needs.` : `${count.toLocaleString()} of these ${of.toLocaleString()} connections go ${text}: not changes a rider needs.`,
  }
}

function gridTrip (
  e: Pick<TransferEvent, 'routeId' | 'directionId' | 'headsign'> & { origin?: string, terminal?: boolean },
  side: 'from' | 'to',
  opts: GridTripOptions,
  ids: { id: string, group: string },
  extraTags: TransferTripTag[] = [],
): TransferGridTrip {
  const route = opts.routes.get(e.routeId)
  const info = opts[side].get(transferTripKey(e))
  return {
    ...ids,
    head: side === 'from',
    route_name: routeLabel(route),
    agency_name: route?.agency_name ?? '',
    headsign: info?.label ?? e.headsign ?? '',
    sign: info?.sign ?? e.headsign ?? '',
    // An arriving destination labeled "From" its origin shows no separate
    // origin.
    origin: side === 'from' && !info?.namedByOrigin ? (e.origin ?? info?.run.origin ?? '') : '',
    tags: [...transferTripTags(info, side, e.terminal), ...extraTags],
  }
}

// The Summary as nested rows: each arriving destination with its figures,
// then a row for each of its departing destinations.
export function transferSummaryGrid (summaries: TransferArrivalSummary[], opts: GridTripOptions): TransferSummaryGridRow[] {
  return summaries.flatMap(({ from, overview, pairs }): TransferSummaryGridRow[] => {
    const group = from.key
    return [
      {
        ...gridTrip(from, 'from', opts, { id: group, group }),
        arrivals: overview.arrivals,
        ...figureColumns(overview),
        median_wait_seconds: overview.medianWait ?? '',
      },
      ...pairs.map((p): TransferSummaryGridRow => ({
        ...gridTrip(p.to, 'to', opts, { id: `${group}>${p.to.key}`, group }, p.sameWay > 0 ? [sameWayTag(p.way, p.sameWay, p.overview.connections)] : []),
        arrivals: '',
        ...figureColumns(p.overview),
        median_wait_seconds: p.overview.medianWait ?? '',
      })),
    ]
  })
}

// A departure's time on its arrival's day, past 24:00 when it leaves after
// midnight. A departure from the evening before, missed by an arrival just
// after midnight, keeps its own day's time.
function departureTime (departure: TransferEvent, dayStart: number): string {
  const seconds = departure.time - dayStart
  return formatGtfsTimeFull(seconds >= 0 ? seconds : departure.seconds)
}

// The Individual report as nested rows: each arrival, then its connections.
export function transferGrid (groups: TransferGroup[], opts: GridTripOptions & { stops: Map<number, TripTableStop> }): TransferGridRow[] {
  return groups.flatMap(({ arrival, connections }): TransferGridRow[] => {
    const group = `${arrival.tripId}|${arrival.serviceDate}|${arrival.time}`
    const dayStart = arrival.time - arrival.seconds
    return [
      {
        ...gridTrip(arrival, 'from', opts, { id: group, group }),
        time: formatGtfsTimeFull(arrival.seconds),
        stop_name: opts.stops.get(arrival.stopId)?.stop_name ?? '',
        walk_seconds: '',
        wait_seconds: '',
        grade: '',
        grade_label: '',
      },
      ...connections.map((c, i) => ({
        ...gridTrip(c.departure, 'to', opts, { id: `${group}>${i}`, group }, c.way ? [sameWayTag(c.way, 1, 1)] : []),
        time: departureTime(c.departure, dayStart),
        // When the rider stays on to another of the stops, name both stops.
        stop_name: c.alight
          ? `${opts.stops.get(c.alight.stopId)?.stop_name ?? ''} → ${opts.stops.get(c.departure.stopId)?.stop_name ?? ''}`
          : opts.stops.get(c.departure.stopId)?.stop_name ?? '',
        walk_seconds: c.walk,
        wait_seconds: c.wait,
        grade: c.grade,
        grade_label: TRANSFER_GRADE_LABELS[c.grade],
      })),
    ]
  })
}

// One connection, or an arrival with none, as a CSV record. Times are
// HH:MM:SS from the arrival's calendar date, so a departure past midnight
// reads 24:00:00 or later.
export interface TransferRow {
  date: string
  arrival_time: string
  from_route_id: string
  from_route_name: string
  from_route_color: string
  from_route_text_color: string
  from_agency_name: string
  from_trip_id: string
  from_headsign: string
  from_stop_id: string
  from_stop_name: string
  departure_time: string
  to_route_id: string
  to_route_name: string
  to_route_color: string
  to_route_text_color: string
  to_agency_name: string
  to_trip_id: string
  to_headsign: string
  to_stop_id: string
  to_stop_name: string
  walk_seconds: number | ''
  wait_seconds: number | ''
  // The grade, or 'none' for an arrival with no connection, and its label.
  grade: TransferGrade | 'none'
  grade_label: string
}

// The Individual report as CSV records: one per connection, and one per
// arrival with none.
export function transferRows (
  groups: TransferGroup[],
  opts: {
    routes: Map<number, TripTableRoute>
    stops: Map<number, TripTableStop>
    tripDetails: Map<number, TripDetail>
  },
): TransferRow[] {
  const rows: TransferRow[] = []
  for (const { arrival, connections } of groups) {
    const { date, seconds } = arrival
    const dayStart = arrival.time - seconds
    const incoming = {
      date,
      arrival_time: formatGtfsTimeFull(seconds),
      ...routeColumns('from', opts.routes.get(arrival.routeId)),
      from_trip_id: opts.tripDetails.get(arrival.tripId)?.tripId ?? '',
      from_headsign: arrival.headsign ?? '',
      ...stopColumns('from', opts.stops.get(arrival.stopId)),
    }
    if (connections.length === 0) {
      rows.push({
        ...incoming,
        departure_time: '',
        ...routeColumns('to', undefined),
        to_trip_id: '',
        to_headsign: '',
        ...stopColumns('to', undefined),
        walk_seconds: '',
        wait_seconds: '',
        grade: 'none',
        grade_label: 'No connection',
      })
      continue
    }
    for (const c of connections) {
      rows.push({
        ...incoming,
        // Where the rider stays on to another of the stops, leaving there.
        ...(c.alight
          ? { arrival_time: formatGtfsTimeFull(c.alight.time - dayStart), ...stopColumns('from', opts.stops.get(c.alight.stopId)) }
          : {}),
        departure_time: departureTime(c.departure, dayStart),
        ...routeColumns('to', opts.routes.get(c.departure.routeId)),
        to_trip_id: opts.tripDetails.get(c.departure.tripId)?.tripId ?? '',
        to_headsign: c.departure.headsign ?? '',
        ...stopColumns('to', opts.stops.get(c.departure.stopId)),
        // Whole seconds: walks come from distances.
        walk_seconds: Math.round(c.walk),
        wait_seconds: Math.round(c.wait),
        grade: c.grade,
        grade_label: TRANSFER_GRADE_LABELS[c.grade],
      })
    }
  }
  return rows
}
