/**
 * Transfers at a stop or stop cluster: each trip arriving there, paired with
 * the trips leaving soon after on other routes, and graded by how long a rider
 * waits after walking between the two stops.
 *
 * Times are absolute seconds (the service date's day number, `isoToOrdinal`,
 * times 86400, plus the feed's GTFS seconds), so a departure past midnight
 * compares correctly with an arrival the evening before.
 */

import { TRANSFER_GRADE_BREAKPOINTS, TRANSFER_WALK_SECONDS_PER_METER, formatDuration, formatGtfsTimeFull } from '../../core'
import type { StopDepartureCache } from '../../tl/departure-cache'
import { isoToOrdinal, ordinalToIso } from '../../tl/feed-version'
import { tripHeadsignAt, type TripDetail } from '../../tl/trip-details'
import { summarizeGaps } from '../route-headway'
import type { TripTableRoute, TripTableStop } from './subject-trips'

const SECONDS_PER_DAY = 86400

// One trip at the subject's stops, as a rider would leave it (an arrival) or
// board it (a departure).
export interface TransferEvent {
  tripId: number
  routeId: number
  directionId: number
  stopId: number
  // The trip's GTFS service date (yyyy-MM-dd).
  serviceDate: string
  // Absolute seconds; see the module comment.
  time: number
  // The calendar date the time falls on, and its seconds into that day.
  date: string
  seconds: number
  headsign?: string
  // Where the trip starts and ends, by station, and how many stops it makes.
  origin?: string
  terminus?: string
  stopCount?: number
  // An arrival on a trip that ends at the stops, or a departure on one that
  // starts there.
  terminal?: boolean
}

export type TransferGrade = 'missed' | 'good' | 'ok' | 'long'

// In order of wait, shortest first.
export const TRANSFER_GRADES: readonly TransferGrade[] = ['missed', 'good', 'ok', 'long']

export const TRANSFER_GRADE_LABELS: Record<TransferGrade, string> = {
  missed: 'Missed',
  good: 'Close',
  ok: 'Acceptable',
  long: 'Unacceptable',
}

// Distinguishable with common forms of color blindness (Okabe-Ito), and
// readable in light and dark themes. `text` is the color for text on `fill`.
export const TRANSFER_GRADE_COLORS: Record<TransferGrade, { fill: string, text: string }> = {
  missed: { fill: '#D55E00', text: '#1a1a1a' },
  good: { fill: '#0072B2', text: '#ffffff' },
  ok: { fill: '#56B4E9', text: '#1a1a1a' },
  long: { fill: '#E69F00', text: '#1a1a1a' },
}

export interface TransferConnection {
  departure: TransferEvent
  walk: number
  // Seconds between arriving after the walk and the departure; negative for a
  // missed connection.
  wait: number
  grade: TransferGrade
  // Likely the arriving vehicle itself, turning back (see calculateTransfers).
  turnback?: boolean
}

export interface TransferGroup {
  arrival: TransferEvent
  // By wait, shortest first.
  connections: TransferConnection[]
}

// How the Transfer Analyst finds and grades connections.
export interface TransferSettings {
  // Where a walk between two different stops gets its distance: a straight
  // line or the street network, from the Transitland directions API; GTFS
  // pathways are not yet supported.
  walkDistance: 'line' | 'street' | 'pathways'
  // Walking time per meter of that distance.
  secondsPerMeter: number
  // Every connection, rather than the first on each route and direction.
  allConnections: boolean
  // Connections that are likely the arriving vehicle turning back, which are
  // otherwise left out.
  countTurnbacks: boolean
  // Five increasing wait breakpoints, in seconds.
  breakpoints: number[]
  // Route, direction, and destination keys (transferTripKey) whose
  // arrivals, or departures, are left out.
  excludedFrom: string[]
  excludedTo: string[]
}

// A trip's route, direction, and destination at the stops, as the settings
// choose them. The destination is the trip's sign there, compared exactly as
// the feed writes it.
export function transferTripKey (e: Pick<TransferEvent, 'routeId' | 'directionId' | 'headsign'>): string {
  return `${e.routeId}|${e.directionId}|${e.headsign ?? ''}`
}

// Where a destination's trips most often start and end, and how many stops
// they make.
export interface TransferTripRun {
  origin?: string
  terminus?: string
  stopCount?: number
}

export interface TransferTripDestination {
  key: string
  label: string
  count: number
  run: TransferTripRun
  // Its trips that end at the stops (arriving) or start there (departing).
  terminal: number
  // Where its run is shorter than its direction's main one, between other
  // ends, that main run.
  shortOf?: TransferTripRun
}

export interface TransferTripDirection {
  directionId: number
  // "Toward X" where most of the direction's trips are signed for, or end
  // at, X; otherwise its number.
  label: string
  count: number
  destinations: TransferTripDestination[]
}

// A route at the stops, its directions, and their destinations, with trip
// counts, as the settings offer them.
export interface TransferRouteChoice {
  id: number
  label: string
  longName: string
  // The route's operator (its GTFS agency), by name.
  operator: string
  count: number
  directions: TransferTripDirection[]
}

export interface TransferChoiceRoute {
  route_id: string
  route_short_name?: string | null
  route_long_name?: string | null
  route_sort_order?: number | null
  agency?: { agency_name?: string | null } | null
}

/**
 * The trips at the stops as a tree of routes, directions, and destinations,
 * as www groups a stop's departures, arriving ('from') or departing ('to').
 *
 * A direction is named for where its trips go: "Toward X" when more than half
 * of them are signed for X, or failing that end at X, or "Toward X or Y" when
 * two cover more than half. Arriving trips that mostly end at the stops are
 * named for where they come from instead ("From X"), as their sign names the
 * stops themselves. Where both directions would read the same, or nothing
 * covers half, a direction is "Direction 0" or "Direction 1".
 *
 * A destination is its sign, or the route's long name; an arriving one whose
 * trips all end at the stops is "From" its origin. Destinations of a route that
 * would read the same are told apart by their direction, else their sign.
 * Routes go by their GTFS sort order, then name.
 *
 * A destination whose trips most often make fewer stops than those of its
 * direction's busiest destination, between other ends, is a short run.
 */
export function transferTripChoices (events: TransferEvent[], routes: Map<number, TransferChoiceRoute>, side: 'from' | 'to' = 'to'): TransferRouteChoice[] {
  interface Tally { count: number, terminal: number, origins: string[], termini: string[], stopCounts: number[] }
  const byRoute = new Map<number, Map<number, Map<string, Tally>>>()
  for (const e of events) {
    const directions = byRoute.get(e.routeId) ?? new Map<number, Map<string, Tally>>()
    const destinations = directions.get(e.directionId) ?? new Map<string, Tally>()
    const headsign = e.headsign ?? ''
    const tally = destinations.get(headsign) ?? { count: 0, terminal: 0, origins: [], termini: [], stopCounts: [] }
    tally.count += 1
    tally.terminal += e.terminal ? 1 : 0
    if (e.origin) {
      tally.origins.push(e.origin)
    }
    if (e.terminus) {
      tally.termini.push(e.terminus)
    }
    if (e.stopCount !== undefined) {
      tally.stopCounts.push(e.stopCount)
    }
    destinations.set(headsign, tally)
    directions.set(e.directionId, destinations)
    byRoute.set(e.routeId, directions)
  }
  const choices = [...byRoute].map(([id, directionMap]) => {
    const route = routes.get(id)
    const label = routeLabel(route) || String(id)
    const signLabel = (headsign: string) => headsign || route?.route_long_name || 'No destination'
    const directions = [...directionMap].map(([directionId, destinationMap]) => {
      const destinations: (TransferTripDestination & { sign: string })[] = [...destinationMap]
        .map(([headsign, t]) => {
          const run = { origin: mostCommon(t.origins), terminus: mostCommon(t.termini), stopCount: mostCommon(t.stopCounts) }
          const fromOrigin = side === 'from' && t.terminal === t.count && run.origin
          return {
            key: transferTripKey({ routeId: id, directionId, headsign }),
            sign: signLabel(headsign),
            label: fromOrigin ? `From ${run.origin}` : signLabel(headsign),
            count: t.count,
            run,
            terminal: t.terminal,
          }
        })
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      const main = destinations[0]?.run
      for (const d of destinations.slice(1)) {
        if (main && isShorter(d.run, main)) {
          d.shortOf = main
        }
      }
      const count = destinations.reduce((n, d) => n + d.count, 0)
      const terminal = destinations.reduce((n, d) => n + d.terminal, 0)
      const tallies = [...destinationMap.values()]
      const signs = new Map<string, number>()
      for (const d of destinations) {
        signs.set(d.sign, (signs.get(d.sign) || 0) + d.count)
      }
      const name = side === 'from' && terminal * 2 > count
        ? prefixed('From', mainOf(countsOf(tallies.flatMap(t => t.origins)), count))
        : prefixed('Toward', mainOf(signs, count) ?? mainOf(countsOf(tallies.flatMap(t => t.termini)), count))
      return {
        directionId,
        name,
        byEnd: prefixed('Toward', mainOf(countsOf(tallies.flatMap(t => t.termini)), count)),
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
      return same.some(o => o.direction !== direction) ? `${x.label} (${direction.label})` : `${x.label} (${x.sign})`
    })
    all.forEach(({ x }, i) => {
      x.label = renamed[i]!
    })
    return {
      id,
      label,
      longName: route?.route_long_name ?? '',
      operator: route?.agency?.agency_name ?? '',
      count: labeled.reduce((n, d) => n + d.count, 0),
      directions: labeled.map(d => ({ ...d, destinations: d.destinations.map(({ sign: _, ...x }) => x) })),
    }
  })
  const sortOrder = (id: number) => routes.get(id)?.route_sort_order ?? Number.POSITIVE_INFINITY
  return choices.sort((a, b) => sortOrder(a.id) - sortOrder(b.id) || a.label.localeCompare(b.label, undefined, { numeric: true }))
}

function countsOf (values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
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

// Each destination of the choices by its key, with its route.
export function transferTripInfo (choices: TransferRouteChoice[]): Map<string, TransferTripDestination & { routeId: number }> {
  return new Map(choices.flatMap(r => r.directions.flatMap(d => d.destinations.map(x => [x.key, { ...x, routeId: r.id }] as const))))
}

// A note on a trip: whether it ends (or starts) at the stops, or is a short
// run; said in full in `title`.
export interface TransferTripTag {
  label: string
  title: string
}

function runText (run: TransferTripRun): string {
  const ends = run.origin && run.terminus ? `${run.origin} to ${run.terminus}` : run.origin || run.terminus || ''
  const stops = run.stopCount !== undefined ? `${run.stopCount} stops` : ''
  return [ends, stops].filter(Boolean).join(', ')
}

const TERMINAL_TEXT = {
  from: { all: 'Ends here', some: 'Some end here', trips: 'end', trip: 'ends', so: 'every rider gets off here' },
  to: { all: 'Starts here', some: 'Some start here', trips: 'start', trip: 'starts', so: 'it brings no one here' },
}

/**
 * The tags for a destination's trips, arriving ('from') or departing ('to'):
 * whether they end or start at the stops (all, or some, of them), and whether
 * they are a short run. For one trip, `terminal` says whether it does.
 */
export function transferTripTags (d: TransferTripDestination | undefined, side: 'from' | 'to', terminal?: boolean): TransferTripTag[] {
  const text = TERMINAL_TEXT[side]
  const tags: TransferTripTag[] = []
  if (terminal) {
    tags.push({ label: text.all, title: `This trip ${text.trip} at the stops, so ${text.so}.` })
  } else if (terminal === undefined && d && d.terminal > 0) {
    tags.push(d.terminal === d.count
      ? { label: text.all, title: `These trips ${text.trips} at the stops, so ${text.so}.` }
      : { label: text.some, title: `${d.terminal.toLocaleString()} of ${d.count.toLocaleString()} of these trips ${text.trips} at the stops.` })
  }
  if (d?.shortOf) {
    tags.push({ label: 'Short run', title: `Runs ${runText(d.run)}; most trips this way run ${runText(d.shortOf)}.` })
  }
  return tags
}

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  walkDistance: 'line',
  secondsPerMeter: TRANSFER_WALK_SECONDS_PER_METER,
  allConnections: false,
  countTurnbacks: false,
  breakpoints: [...TRANSFER_GRADE_BREAKPOINTS],
  excludedFrom: [],
  excludedTo: [],
}

// The groups whose arrival falls on a date (all dates when undefined). The
// time of day is the scenario's, which transferEvents already keeps to.
export function filterTransferGroups (groups: TransferGroup[], date: string | undefined): TransferGroup[] {
  return groups.filter(({ arrival: a }) => date === undefined || a.date === date)
}

// Whether breakpoints can grade waits: five, strictly increasing.
export function validBreakpoints (breakpoints: readonly number[]): boolean {
  return breakpoints.length === 5 && breakpoints.every((b, i) => Number.isFinite(b) && (i === 0 || b > breakpoints[i - 1]!))
}

export interface TransferOptions {
  // Walking time between two stops, in seconds; not finite where it is not
  // known, which leaves that pair of stops out.
  walkSeconds: (fromStopId: number, toStopId: number) => number
  // The most walkSeconds returns, to bound the search.
  maxWalkSeconds: number
  // Five increasing wait breakpoints, in seconds: missed, close (good),
  // acceptable (OK), and unacceptable (long) fall between consecutive pairs.
  breakpoints: readonly number[]
  // Every connection, rather than the first on each route, direction, and
  // destination (and any missed just before it).
  allConnections?: boolean
  // A route's agency, to tell a likely turnback; and whether to count them.
  agencyOf?: (routeId: number) => number | undefined
  countTurnbacks?: boolean
}

// The calendar date an absolute time falls on, and its seconds into that day.
export function calendarTime (time: number, dateOf: (day: number) => string = ordinalToIso): { date: string, seconds: number } {
  const day = Math.floor(time / SECONDS_PER_DAY)
  return { date: dateOf(day), seconds: time - day * SECONDS_PER_DAY }
}

export function transferGrade (wait: number, breakpoints: readonly number[] = TRANSFER_GRADE_BREAKPOINTS): TransferGrade {
  if (wait < breakpoints[1]!) {
    return 'missed'
  }
  if (wait < breakpoints[2]!) {
    return 'good'
  }
  if (wait < breakpoints[3]!) {
    return 'ok'
  }
  return 'long'
}

export interface TransferEventsOptions {
  stopIds: number[]
  // Calendar dates (yyyy-MM-dd) whose arrivals count: the scenario's dates,
  // scoped to its weekdays.
  dates: string[]
  // The time-of-day window arrivals must fall in, in seconds.
  startTime: number
  endTime: number
  stopDepartureCache: StopDepartureCache
  tripDetails: Map<number, TripDetail>
  // The longest walk and wait, which bound how late a departure can connect.
  maxWalkSeconds: number
  breakpoints: readonly number[]
}

export interface TransferEvents {
  arrivals: TransferEvent[]
  departures: TransferEvent[]
  // Trips the transfers need whose details have not arrived, so are left out
  // until they do.
  missingTripIds: number[]
}

/**
 * The arrivals and departures at a subject's stops. A trip arrives where it
 * lets riders off, coming from somewhere else, and departs where it picks
 * them up, going on somewhere else; a trip moving only between the stops
 * does neither. Each says whether the trip ends (or starts) at the stops. A trip at several of the stops arrives at
 * the first of them and departs from the last, the most time it gives a rider.
 *
 * The departure cache gives each departure's time; the trip's details give its
 * arrival there (by the scheduled gap between the two), its place in the trip,
 * and drop-off rules.
 */
export function transferEvents (opts: TransferEventsOptions): TransferEvents {
  const arrivals = new Map<string, TransferEvent>()
  const departures = new Map<string, TransferEvent>()
  const missing = new Set<number>()
  const atStops = new Set(opts.stopIds)
  // A handful of days recur, so each day's date is worked out once.
  const dateCache = new Map<number, string>()
  const dateOf = (day: number) => {
    let date = dateCache.get(day)
    if (date === undefined) {
      date = ordinalToIso(day)
      dateCache.set(day, date)
    }
    return date
  }
  // Departures that can matter: from the window's start, less the earliest
  // a missed connection reaches back, to its end plus the longest walk and
  // wait. One early in a day may connect from an arrival late the day
  // before, so is also read as a day later.
  const bp = opts.breakpoints
  const from = opts.startTime + Math.min(0, bp[0]!)
  const until = opts.endTime + opts.maxWalkSeconds + bp[bp.length - 1]!
  const sameDay = (t: number) => t >= from && t <= until
  const dayLater = (t: number) => t + SECONDS_PER_DAY >= from && t + SECONDS_PER_DAY <= until
  // The dates, and the day after each for connections past midnight, which
  // reads only those.
  const days = new Map<number, boolean>()
  for (const d of opts.dates) {
    const day = isoToOrdinal(d)
    days.set(day, false)
    if (!days.has(day + 1)) {
      days.set(day + 1, true)
    }
  }
  for (const [day, afterMidnightOnly] of days) {
    const date = dateOf(day)
    for (const stopId of opts.stopIds) {
      for (const st of opts.stopDepartureCache.get(stopId, date)) {
        const t = st.departureTime % SECONDS_PER_DAY
        if (!(dayLater(t) || (!afterMidnightOnly && sameDay(t)))) {
          continue
        }
        const detail = opts.tripDetails.get(st.tripId)
        if (!detail) {
          missing.add(st.tripId)
          continue
        }
        // A trip calling at the stop more than once is matched to the call
        // nearest the departure, as a call may have no departure time of its
        // own in the details.
        const stopTimes = detail.stopTimes
        let index = -1
        for (let i = 0; i < stopTimes.length; i++) {
          const s = stopTimes[i]!
          if (s.stopId === stopId && (index < 0 || Math.abs((s.departure ?? Infinity) - st.departureTime) < Math.abs((stopTimes[index]!.departure ?? Infinity) - st.departureTime))) {
            index = i
          }
        }
        const stopTime = stopTimes[index]
        if (!stopTime) {
          continue
        }
        const serviceDay = day - Math.floor(st.departureTime / SECONDS_PER_DAY)
        const serviceDate = dateOf(serviceDay)
        const base = serviceDay * SECONDS_PER_DAY
        // One run of the trip: a trip from frequencies.txt runs many times a
        // day under one id, each run offset from its stated times.
        const runOffset = st.departureTime - (stopTime.departure ?? st.departureTime)
        const key = `${st.tripId}|${serviceDate}|${runOffset}`
        const headsign = tripHeadsignAt(detail, stopId)
        const event = (time: number): TransferEvent => ({
          tripId: st.tripId,
          routeId: st.routeId,
          directionId: st.directionId,
          stopId,
          serviceDate,
          time,
          ...calendarTime(time, dateOf),
          headsign,
          origin: detail.firstStopName,
          terminus: detail.lastStopName,
          stopCount: stopTimes.length,
        })
        // Whether the trip calls anywhere else before the stop, and after it.
        let comesFrom = false
        let goesOn = false
        for (let i = 0; i < stopTimes.length; i++) {
          if (i !== index && !atStops.has(stopTimes[i]!.stopId)) {
            if (i < index) {
              comesFrom = true
            } else {
              goesOn = true
            }
          }
        }
        if (comesFrom && stopTime.dropOffType !== 1) {
          const dwell = stopTime.arrival !== undefined && stopTime.departure !== undefined ? stopTime.departure - stopTime.arrival : 0
          const time = base + st.departureTime - Math.max(0, dwell)
          const seen = arrivals.get(key)
          if (!seen || time < seen.time) {
            arrivals.set(key, { ...event(time), terminal: !goesOn })
          }
        }
        if (goesOn && (st.pickupType ?? stopTime.pickupType) !== 1) {
          const time = base + st.departureTime
          const seen = departures.get(key)
          if (!seen || time > seen.time) {
            departures.set(key, { ...event(time), terminal: !comesFrom })
          }
        }
      }
    }
  }
  // Arrivals on the dates and in the window; departures at any time, as a
  // connection may leave after the window ends.
  const dates = new Set(opts.dates)
  const inWindow = (e: TransferEvent) => dates.has(e.date) && e.seconds >= opts.startTime && e.seconds <= opts.endTime
  return {
    arrivals: [...arrivals.values()].filter(inWindow).sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    departures: [...departures.values()].sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    missingTripIds: [...missing],
  }
}

// Whether a departure is likely the arriving vehicle turning back: the
// arrival ends at the stop the departure starts from, on the same agency.
function isTurnback (arrival: TransferEvent, departure: TransferEvent, agencyOf?: (routeId: number) => number | undefined): boolean {
  if (!arrival.terminal || !departure.terminal || arrival.stopId !== departure.stopId || !agencyOf) {
    return false
  }
  const agency = agencyOf(arrival.routeId)
  return agency !== undefined && agency === agencyOf(departure.routeId)
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

/**
 * Each arrival's connections: departures on another route whose wait after
 * walking falls within the breakpoints. The same route either way is not a
 * transfer: in the other direction it is often the same vehicle turning
 * back at the end of its run. Unless `allConnections`, each route, direction,
 * and destination shows its first connection a rider makes and any missed
 * just before it, as later departures on it are not where riders transfer. A
 * short run counts apart from the full one, as it may not go where a rider is
 * headed.
 *
 * A departure that starts at the same stop where an arrival of the same agency
 * ends is likely that vehicle turning back, as where a feed models each
 * direction as its own route; such connections are left out unless
 * `countTurnbacks`, and marked when counted.
 */
export function calculateTransfers (arrivals: TransferEvent[], departures: TransferEvent[], opts: TransferOptions): TransferGroup[] {
  const bp = opts.breakpoints
  const minWait = bp[0]!
  const maxWait = bp[bp.length - 1]!
  // The destinations (transferTripKey) an arrival has made a connection to,
  // cleared for each arrival.
  const made = new Set<string>()
  return arrivals.map((arrival) => {
    const connections: TransferConnection[] = []
    const last = arrival.time + opts.maxWalkSeconds + maxWait
    // Departures come sorted by time, as transferEvents gives them.
    for (let i = lowerBound(departures, arrival.time + minWait); i < departures.length && departures[i]!.time <= last; i++) {
      const departure = departures[i]!
      // Not the same route either way, which takes in the same trip.
      if (departure.routeId === arrival.routeId) {
        continue
      }
      const walk = opts.walkSeconds(arrival.stopId, departure.stopId)
      if (!Number.isFinite(walk)) {
        continue
      }
      const wait = departure.time - arrival.time - walk
      if (wait < minWait || wait > maxWait) {
        continue
      }
      const turnback = isTurnback(arrival, departure, opts.agencyOf)
      if (turnback && !opts.countTurnbacks) {
        continue
      }
      connections.push({ departure, walk, wait, grade: transferGrade(wait, bp), ...(turnback ? { turnback } : {}) })
    }
    connections.sort((a, b) => a.wait - b.wait || a.departure.routeId - b.departure.routeId)
    if (opts.allConnections) {
      return { arrival, connections }
    }
    made.clear()
    return {
      arrival,
      connections: connections.filter((c) => {
        const key = transferTripKey(c.departure)
        if (made.has(key)) {
          return false
        }
        if (c.grade !== 'missed') {
          made.add(key)
        }
        return true
      }),
    }
  })
}

export interface TransferGradeCount {
  grade: TransferGrade
  count: number
  // Of all connections.
  share: number
}

export interface TransferOverview {
  arrivals: number
  connections: number
  // Connections by grade, in order of wait.
  grades: TransferGradeCount[]
  // Arrivals whose soonest connection made, on any route, is close or
  // acceptable (graded good or OK); and
  // good, and OK, apart.
  goodOrOkShare: number
  goodShare: number
  okShare: number
  // The wait for each arrival's soonest connection made, over arrivals that
  // make one.
  medianWait?: number
}

// The figures over all of the groups' arrivals.
export function transferOverview (groups: TransferGroup[]): TransferOverview {
  const counts: Record<TransferGrade, number> = { missed: 0, good: 0, ok: 0, long: 0 }
  let connections = 0
  let good = 0
  let ok = 0
  const waits: number[] = []
  for (const g of groups) {
    for (const c of g.connections) {
      counts[c.grade] += 1
    }
    connections += g.connections.length
    // Connections are sorted by wait, so the first made (not missed) is the
    // soonest.
    const soonest = g.connections.find(c => c.grade !== 'missed')
    if (soonest) {
      waits.push(soonest.wait)
      good += soonest.grade === 'good' ? 1 : 0
      ok += soonest.grade === 'ok' ? 1 : 0
    }
  }
  return {
    arrivals: groups.length,
    connections,
    grades: TRANSFER_GRADES.map(grade => ({ grade, count: counts[grade], share: connections > 0 ? counts[grade] / connections : 0 })),
    goodOrOkShare: groups.length > 0 ? (good + ok) / groups.length : 0,
    goodShare: groups.length > 0 ? good / groups.length : 0,
    okShare: groups.length > 0 ? ok / groups.length : 0,
    medianWait: summarizeGaps(waits)?.median,
  }
}

// The most common of some values.
function mostCommon<T extends string | number> (values: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  let best: T | undefined
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
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
  // Connections that are likely turnbacks, where they are counted.
  turnbacks: number
  // Connections by grade.
  missed: number
  good: number
  ok: number
  long: number
  // Arrivals whose first connection made to the departing destination is
  // close or acceptable (good or OK), of all the arriving destination's
  // arrivals; and close, and acceptable, apart.
  goodOrOkShare: number
  goodShare: number
  okShare: number
  // The wait for the first connection made, over arrivals that make one.
  medianWait?: number
}

// An arriving destination: its figures over all of its arrivals, as the
// overview's, and its connections by departing destination.
export interface TransferArrivalSummary {
  from: TransferTripRef
  overview: TransferOverview
  pairs: TransferPairSummary[]
}

/**
 * Connections totaled by the arriving trips' destination (route, direction,
 * and sign), and under each, by the departing trips'. A pair's shares are of
 * every arrival on its arriving destination, connected to the departing one
 * or not. Arriving destinations go by most arrivals; departing ones, by most
 * connections made.
 */
export function summarizeTransfers (groups: TransferGroup[]): TransferArrivalSummary[] {
  const byFrom = new Map<string, TransferGroup[]>()
  for (const g of groups) {
    const key = transferTripKey(g.arrival)
    byFrom.set(key, [...(byFrom.get(key) ?? []), g])
  }
  return [...byFrom.values()].map((fromGroups) => {
    const arrivals = fromGroups.length
    const pairs = new Map<string, { pair: TransferPairSummary, firstWaits: number[], firstGood: number, firstOk: number }>()
    for (const { connections } of fromGroups) {
      const firstMade = new Set<string>()
      for (const c of connections) {
        const to = tripRef(c.departure)
        let p = pairs.get(to.key)
        if (!p) {
          p = { pair: { to, turnbacks: 0, missed: 0, good: 0, ok: 0, long: 0, goodOrOkShare: 0, goodShare: 0, okShare: 0 }, firstWaits: [], firstGood: 0, firstOk: 0 }
          pairs.set(to.key, p)
        }
        p.pair[c.grade] += 1
        p.pair.turnbacks += c.turnback ? 1 : 0
        if (c.grade !== 'missed' && !firstMade.has(to.key)) {
          firstMade.add(to.key)
          p.firstWaits.push(c.wait)
          p.firstGood += c.grade === 'good' ? 1 : 0
          p.firstOk += c.grade === 'ok' ? 1 : 0
        }
      }
    }
    return {
      from: tripRef(fromGroups[0]!.arrival),
      overview: transferOverview(fromGroups),
      pairs: [...pairs.values()].map(({ pair, firstWaits, firstGood, firstOk }) => ({
        ...pair,
        goodOrOkShare: (firstGood + firstOk) / arrivals,
        goodShare: firstGood / arrivals,
        okShare: firstOk / arrivals,
        medianWait: summarizeGaps(firstWaits)?.median,
      })).sort((a, b) => b.good + b.ok + b.long - (a.good + a.ok + a.long) || a.to.key.localeCompare(b.to.key)),
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

function routeLabel (route: Pick<TripTableRoute, 'route_id' | 'route_short_name' | 'route_long_name'> | undefined): string {
  return route?.route_short_name || route?.route_long_name || route?.route_id || ''
}

// The route pair summary as table rows (and CSV records).
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
  to_direction_id: number
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

// A row per pair of arriving and departing destinations, for the CSV.
export function transferSummaryRows (summaries: TransferArrivalSummary[], routes: Map<number, TripTableRoute>): TransferSummaryRow[] {
  return summaries.flatMap(({ from: f, overview, pairs }) => {
    const from = routes.get(f.routeId)
    return pairs.map((s) => {
      const to = routes.get(s.to.routeId)
      return {
        from_route_id: from?.route_id ?? '',
        from_route_name: routeLabel(from),
        from_route_color: from?.route_color ?? '',
        from_route_text_color: from?.route_text_color ?? '',
        from_agency_name: from?.agency_name ?? '',
        from_direction_id: f.directionId,
        from_headsign: f.headsign ?? '',
        to_route_id: to?.route_id ?? '',
        to_route_name: routeLabel(to),
        to_route_color: to?.route_color ?? '',
        to_route_text_color: to?.route_text_color ?? '',
        to_agency_name: to?.agency_name ?? '',
        to_direction_id: s.to.directionId,
        to_headsign: s.to.headsign ?? '',
        arrivals: overview.arrivals,
        missed: s.missed,
        close: s.good,
        acceptable: s.ok,
        unacceptable: s.long,
        close_or_acceptable_share: percent(s.goodOrOkShare),
        close_share: percent(s.goodShare),
        acceptable_share: percent(s.okShare),
        median_wait_seconds: s.medianWait ?? '',
      }
    })
  })
}

// A row of the report's nested tables: an arriving trip (or destination),
// heading its group, or a departing one under it. Rows share their trip
// columns, so the grid sorts a group's heading and its rows alike.
export interface TransferGridTrip {
  id: string
  // The heading row's id, for every row of its group.
  group: string
  head: boolean
  route_id: number
  route_name: string
  agency_name: string
  // The destination's name: its sign, else the route's long name.
  headsign: string
  // Where an arriving trip comes from.
  origin: string
  tags: TransferTripTag[]
}

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

export interface TransferGridRow extends TransferGridTrip {
  // HH:MM:SS: the arrival on a heading row, the departure under it.
  time: string
  stop_name: string
  walk_seconds: number | ''
  wait_seconds: number | ''
  // Blank on a heading row with connections; 'none' on one without.
  grade: TransferGrade | 'none' | ''
  grade_label: string
}

interface GridTripOptions {
  routes: Map<number, TripTableRoute>
  // The destinations at the stops (transferTripInfo), arriving and departing.
  from: Map<string, TransferTripDestination>
  to: Map<string, TransferTripDestination>
}

// The tag for connections that are likely the arriving vehicle turning back.
function turnbackTag (count: number, of: number): TransferTripTag {
  return {
    label: 'Likely same vehicle',
    title: of === 1
      ? 'This trip ends here and this one starts from the same stop, on the same agency: likely the same vehicle turning back.'
      : `${count.toLocaleString()} of these ${of.toLocaleString()} connections are likely the arriving vehicle turning back: it ends here and the departing trip starts from the same stop, on the same agency.`,
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
    route_id: e.routeId,
    route_name: routeLabel(route),
    agency_name: route?.agency_name ?? '',
    headsign: info?.label ?? e.headsign ?? '',
    // Named "From" its origin, an arriving trip needs no origin beside.
    origin: side === 'from' && !info?.label.startsWith('From ') ? (e.origin ?? info?.run.origin ?? '') : '',
    tags: [...transferTripTags(info, side, e.terminal), ...extraTags],
  }
}

// The Summary as nested rows: each arriving destination with its figures,
// then each departing one it connects to.
export function transferSummaryGrid (summaries: TransferArrivalSummary[], opts: GridTripOptions): TransferSummaryGridRow[] {
  return summaries.flatMap(({ from, overview, pairs }): TransferSummaryGridRow[] => {
    const group = from.key
    const count = (grade: TransferGrade) => overview.grades.find(g => g.grade === grade)?.count ?? 0
    return [
      {
        ...gridTrip(from, 'from', opts, { id: group, group }),
        arrivals: overview.arrivals,
        missed: count('missed'),
        close: count('good'),
        acceptable: count('ok'),
        unacceptable: count('long'),
        close_or_acceptable_share: percent(overview.goodOrOkShare),
        close_share: percent(overview.goodShare),
        acceptable_share: percent(overview.okShare),
        median_wait_seconds: overview.medianWait ?? '',
      },
      ...pairs.map((p): TransferSummaryGridRow => ({
        ...gridTrip(p.to, 'to', opts, { id: `${group}>${p.to.key}`, group }, p.turnbacks > 0 ? [turnbackTag(p.turnbacks, p.missed + p.good + p.ok + p.long)] : []),
        arrivals: '',
        missed: p.missed,
        close: p.good,
        acceptable: p.ok,
        unacceptable: p.long,
        close_or_acceptable_share: percent(p.goodOrOkShare),
        close_share: percent(p.goodShare),
        acceptable_share: percent(p.okShare),
        median_wait_seconds: p.medianWait ?? '',
      })),
    ]
  })
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
        grade: connections.length > 0 ? '' : 'none',
        grade_label: connections.length > 0 ? '' : 'No connection',
      },
      ...connections.map((c, i) => ({
        ...gridTrip(c.departure, 'to', opts, { id: `${group}>${i}`, group }, c.turnback ? [turnbackTag(1, 1)] : []),
        time: formatGtfsTimeFull(c.departure.time - dayStart),
        stop_name: opts.stops.get(c.departure.stopId)?.stop_name ?? '',
        walk_seconds: c.walk,
        wait_seconds: c.wait,
        grade: c.grade,
        grade_label: TRANSFER_GRADE_LABELS[c.grade],
      })),
    ]
  })
}

// One connection, or an arrival with none, as a table row (and CSV record).
// Times are HH:MM:SS from the arrival's calendar date, so a departure past
// midnight reads 24:00:00 or later.
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
  // The grade, or 'none' for an arrival with no connection; and as words.
  grade: TransferGrade | 'none'
  grade_label: string
}

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
    const from = opts.routes.get(arrival.routeId)
    const fromStop = opts.stops.get(arrival.stopId)
    const incoming = {
      date,
      arrival_time: formatGtfsTimeFull(seconds),
      from_route_id: from?.route_id ?? '',
      from_route_name: routeLabel(from),
      from_route_color: from?.route_color ?? '',
      from_route_text_color: from?.route_text_color ?? '',
      from_agency_name: from?.agency_name ?? '',
      from_trip_id: opts.tripDetails.get(arrival.tripId)?.tripId ?? '',
      from_headsign: arrival.headsign ?? '',
      from_stop_id: fromStop?.stop_id ?? '',
      from_stop_name: fromStop?.stop_name ?? '',
    }
    if (connections.length === 0) {
      rows.push({
        ...incoming,
        departure_time: '',
        to_route_id: '',
        to_route_name: '',
        to_route_color: '',
        to_route_text_color: '',
        to_agency_name: '',
        to_trip_id: '',
        to_headsign: '',
        to_stop_id: '',
        to_stop_name: '',
        walk_seconds: '',
        wait_seconds: '',
        grade: 'none',
        grade_label: 'No connection',
      })
      continue
    }
    for (const c of connections) {
      const to = opts.routes.get(c.departure.routeId)
      const toStop = opts.stops.get(c.departure.stopId)
      rows.push({
        ...incoming,
        departure_time: formatGtfsTimeFull(c.departure.time - dayStart),
        to_route_id: to?.route_id ?? '',
        to_route_name: routeLabel(to),
        to_route_color: to?.route_color ?? '',
        to_route_text_color: to?.route_text_color ?? '',
        to_agency_name: to?.agency_name ?? '',
        to_trip_id: opts.tripDetails.get(c.departure.tripId)?.tripId ?? '',
        to_headsign: c.departure.headsign ?? '',
        to_stop_id: toStop?.stop_id ?? '',
        to_stop_name: toStop?.stop_name ?? '',
        walk_seconds: c.walk,
        wait_seconds: c.wait,
        grade: c.grade,
        grade_label: TRANSFER_GRADE_LABELS[c.grade],
      })
    }
  }
  return rows
}
