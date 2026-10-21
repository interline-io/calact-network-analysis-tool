/**
 * Transfers at a stop or stop cluster: each trip arriving there, paired with
 * the trips leaving soon after on other routes, and graded by how long a rider
 * waits after walking between the two stops.
 *
 * Times are absolute seconds (`dayNumber(serviceDate) * 86400` plus the feed's
 * GTFS seconds), so a departure past midnight compares correctly with an
 * arrival the evening before.
 */

import { TRANSFER_GRADE_BREAKPOINTS, TRANSFER_WALK_SECONDS_PER_METER, formatGtfsTimeFull } from '../../core'
import type { StopDepartureCache } from '../../tl/departure-cache'
import { tripHeadsignAt, type TripDetail } from '../../tl/trip-details'
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
  headsign?: string
}

export type TransferGrade = 'missed' | 'good' | 'ok' | 'long'

// In order of wait, shortest first.
export const TRANSFER_GRADES: readonly TransferGrade[] = ['missed', 'good', 'ok', 'long']

export const TRANSFER_GRADE_LABELS: Record<TransferGrade, string> = {
  missed: 'Missed',
  good: 'Good',
  ok: 'OK',
  long: 'Long wait',
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
  // Five increasing wait breakpoints, in seconds.
  breakpoints: number[]
  // Routes whose arrivals, or departures, are left out.
  excludedFromRoutes: number[]
  excludedToRoutes: number[]
}

export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
  walkDistance: 'line',
  secondsPerMeter: TRANSFER_WALK_SECONDS_PER_METER,
  allConnections: false,
  breakpoints: [...TRANSFER_GRADE_BREAKPOINTS],
  excludedFromRoutes: [],
  excludedToRoutes: [],
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
  // Five increasing wait breakpoints, in seconds: missed, good, OK, and long
  // wait fall between consecutive pairs.
  breakpoints?: readonly number[]
  // Every connection, rather than the first on each route and direction (and
  // any missed just before it).
  allConnections?: boolean
}

// Days since 1970-01-01 for a yyyy-MM-dd date.
export function dayNumber (date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!) / (SECONDS_PER_DAY * 1000)
}

// The yyyy-MM-dd date for a day number.
export function dayString (day: number): string {
  return new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10)
}

// The calendar date an absolute time falls on, and its seconds into that day.
export function calendarTime (time: number): { date: string, seconds: number } {
  const day = Math.floor(time / SECONDS_PER_DAY)
  return { date: dayString(day), seconds: time - day * SECONDS_PER_DAY }
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
}

export interface TransferEvents {
  arrivals: TransferEvent[]
  departures: TransferEvent[]
  // Trips at the stops whose details have not arrived, so are left out.
  missingDetails: number
}

// The calendar dates to read departures from: the dates themselves, and the
// day after each, for connections past midnight.
function departureDates (dates: string[]): string[] {
  const days = new Set<string>()
  for (const d of dates) {
    days.add(d)
    days.add(dayString(dayNumber(d) + 1))
  }
  return [...days]
}

/**
 * The arrivals and departures at a subject's stops. A trip arrives where it
 * lets riders off, other than at its first stop, and departs where it picks
 * them up, other than at its last. A trip at several of the stops arrives at
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
  for (const date of departureDates(opts.dates)) {
    for (const stopId of opts.stopIds) {
      for (const st of opts.stopDepartureCache.get(stopId, date)) {
        const detail = opts.tripDetails.get(st.tripId)
        if (!detail) {
          missing.add(st.tripId)
          continue
        }
        const stopTimes = detail.stopTimes
        // A trip calling at the stop twice is matched by its departure time.
        let index = stopTimes.findIndex(s => s.stopId === stopId && s.departure === st.departureTime)
        if (index < 0) {
          index = stopTimes.findIndex(s => s.stopId === stopId)
        }
        const stopTime = stopTimes[index]
        if (!stopTime) {
          continue
        }
        const serviceDay = dayNumber(date) - Math.floor(st.departureTime / SECONDS_PER_DAY)
        const serviceDate = dayString(serviceDay)
        const base = serviceDay * SECONDS_PER_DAY
        const key = `${st.tripId}|${serviceDate}`
        const event = {
          tripId: st.tripId,
          routeId: st.routeId,
          directionId: st.directionId,
          stopId,
          serviceDate,
          headsign: tripHeadsignAt(detail, stopId),
        }
        if (index > 0 && stopTime.dropOffType !== 1) {
          const dwell = stopTime.arrival !== undefined && stopTime.departure !== undefined ? stopTime.departure - stopTime.arrival : 0
          const time = base + st.departureTime - Math.max(0, dwell)
          const seen = arrivals.get(key)
          if (!seen || time < seen.time) {
            arrivals.set(key, { ...event, time })
          }
        }
        if (index < stopTimes.length - 1 && (st.pickupType ?? stopTime.pickupType) !== 1) {
          const time = base + st.departureTime
          const seen = departures.get(key)
          if (!seen || time > seen.time) {
            departures.set(key, { ...event, time })
          }
        }
      }
    }
  }
  // Arrivals on the dates and in the window; departures at any time, as a
  // connection may leave after the window ends.
  const dates = new Set(opts.dates)
  const inWindow = (e: TransferEvent) => {
    const { date, seconds } = calendarTime(e.time)
    return dates.has(date) && seconds >= opts.startTime && seconds <= opts.endTime
  }
  return {
    arrivals: [...arrivals.values()].filter(inWindow).sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    departures: [...departures.values()].sort((a, b) => a.time - b.time || a.tripId - b.tripId),
    missingDetails: missing.size,
  }
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
 * back at the end of its run. Unless `allConnections`, a route and direction shows its first
 * connection a rider makes and any missed just before it, as later departures
 * on it are not where riders transfer.
 */
export function calculateTransfers (arrivals: TransferEvent[], departures: TransferEvent[], opts: TransferOptions): TransferGroup[] {
  const bp = opts.breakpoints ?? TRANSFER_GRADE_BREAKPOINTS
  const minWait = bp[0]!
  const maxWait = bp[bp.length - 1]!
  // Departures must be sorted by time.
  const sorted = departures.every((d, i) => i === 0 || departures[i - 1]!.time <= d.time) ? departures : [...departures].sort((a, b) => a.time - b.time)
  return arrivals.map((arrival) => {
    const connections: TransferConnection[] = []
    const last = arrival.time + opts.maxWalkSeconds + maxWait
    for (let i = lowerBound(sorted, arrival.time + minWait); i < sorted.length && sorted[i]!.time <= last; i++) {
      const departure = sorted[i]!
      if (departure.tripId === arrival.tripId) {
        continue
      }
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
      connections.push({ departure, walk, wait, grade: transferGrade(wait, bp) })
    }
    connections.sort((a, b) => a.wait - b.wait || a.departure.routeId - b.departure.routeId)
    if (opts.allConnections) {
      return { arrival, connections }
    }
    const made = new Set<string>()
    return {
      arrival,
      connections: connections.filter((c) => {
        const key = `${c.departure.routeId}|${c.departure.directionId}`
        if (made.has(key)) {
          return false
        }
        if (c.wait >= 0) {
          made.add(key)
        }
        return true
      }),
    }
  })
}

export interface TransferGradeCount {
  grade: TransferGrade
  label: string
  count: number
  // Of all connections.
  share: number
}

export function transferGradeCounts (groups: TransferGroup[]): TransferGradeCount[] {
  const counts = new Map<TransferGrade, number>(TRANSFER_GRADES.map(g => [g, 0]))
  let total = 0
  for (const g of groups) {
    for (const c of g.connections) {
      counts.set(c.grade, counts.get(c.grade)! + 1)
      total += 1
    }
  }
  return TRANSFER_GRADES.map(grade => ({
    grade,
    label: TRANSFER_GRADE_LABELS[grade],
    count: counts.get(grade)!,
    share: total > 0 ? counts.get(grade)! / total : 0,
  }))
}

export interface TransferOverview {
  arrivals: number
  connections: number
  // Arrivals whose soonest connection made, on any route, is good or OK.
  goodOrOkShare: number
  // The wait for each arrival's soonest connection made, over arrivals that
  // make one.
  medianWait?: number
}

// The figures over all of the groups' arrivals.
export function transferOverview (groups: TransferGroup[]): TransferOverview {
  let connections = 0
  let goodOrOk = 0
  const waits: number[] = []
  for (const g of groups) {
    connections += g.connections.length
    // Connections are sorted by wait, so the first made is the soonest.
    const soonest = g.connections.find(c => c.wait >= 0)
    if (soonest) {
      waits.push(soonest.wait)
      if (soonest.grade === 'good' || soonest.grade === 'ok') {
        goodOrOk += 1
      }
    }
  }
  return {
    arrivals: groups.length,
    connections,
    goodOrOkShare: groups.length > 0 ? goodOrOk / groups.length : 0,
    medianWait: median(waits.sort((a, b) => a - b)),
  }
}

// The middle value of sorted numbers.
function median (sorted: number[]): number | undefined {
  if (sorted.length === 0) {
    return undefined
  }
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2
}

// The most common of some values.
function mostCommon (values: (string | undefined)[]): string {
  const counts = new Map<string, number>()
  for (const v of values) {
    if (v) {
      counts.set(v, (counts.get(v) || 0) + 1)
    }
  }
  let best = ''
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}

export interface TransferPairSummary {
  key: string
  fromRouteId: number
  fromDirectionId: number
  fromHeadsign: string
  toRouteId: number
  toDirectionId: number
  toHeadsign: string
  // Arrivals on the incoming route and direction.
  arrivals: number
  // Connections by grade.
  missed: number
  good: number
  ok: number
  long: number
  // Arrivals whose first connection made to the outgoing route and direction
  // is good or OK, of all its arrivals.
  goodOrOkShare: number
  // The wait for the first connection made, over arrivals that make one.
  medianWait?: number
}

/**
 * Connections totaled by route pair: the incoming route and direction, and the
 * outgoing one. Each row's arrivals are every arrival on its incoming route
 * and direction, connected to the outgoing one or not.
 */
export function summarizeTransfers (groups: TransferGroup[]): TransferPairSummary[] {
  const arrivalsByRoute = new Map<string, number>()
  const pairs = new Map<string, {
    summary: TransferPairSummary
    fromHeadsigns: (string | undefined)[]
    toHeadsigns: (string | undefined)[]
    firstWaits: number[]
    goodOrOk: number
  }>()
  for (const { arrival, connections } of groups) {
    const fromKey = `${arrival.routeId}|${arrival.directionId}`
    arrivalsByRoute.set(fromKey, (arrivalsByRoute.get(fromKey) || 0) + 1)
    const firstMade = new Set<string>()
    for (const c of connections) {
      const toKey = `${c.departure.routeId}|${c.departure.directionId}`
      const key = `${fromKey}|${toKey}`
      let pair = pairs.get(key)
      if (!pair) {
        pair = {
          summary: {
            key,
            fromRouteId: arrival.routeId,
            fromDirectionId: arrival.directionId,
            fromHeadsign: '',
            toRouteId: c.departure.routeId,
            toDirectionId: c.departure.directionId,
            toHeadsign: '',
            arrivals: 0,
            missed: 0,
            good: 0,
            ok: 0,
            long: 0,
            goodOrOkShare: 0,
          },
          fromHeadsigns: [],
          toHeadsigns: [],
          firstWaits: [],
          goodOrOk: 0,
        }
        pairs.set(key, pair)
      }
      pair.summary[c.grade] += 1
      pair.toHeadsigns.push(c.departure.headsign)
      if (c.wait >= 0 && !firstMade.has(toKey)) {
        firstMade.add(toKey)
        pair.fromHeadsigns.push(arrival.headsign)
        pair.firstWaits.push(c.wait)
        if (c.grade === 'good' || c.grade === 'ok') {
          pair.goodOrOk += 1
        }
      }
    }
  }
  return [...pairs.values()].map(({ summary, fromHeadsigns, toHeadsigns, firstWaits, goodOrOk }) => {
    const arrivals = arrivalsByRoute.get(`${summary.fromRouteId}|${summary.fromDirectionId}`) || 0
    return {
      ...summary,
      fromHeadsign: mostCommon(fromHeadsigns),
      toHeadsign: mostCommon(toHeadsigns),
      arrivals,
      goodOrOkShare: arrivals > 0 ? goodOrOk / arrivals : 0,
      medianWait: median(firstWaits.sort((a, b) => a - b)),
    }
  }).sort((a, b) => b.arrivals - a.arrivals || a.key.localeCompare(b.key))
}

// A wait as minutes and seconds, signed when missed: "4:30", "-1:15".
export function formatWait (seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) {
    return ''
  }
  const total = Math.round(Math.abs(seconds))
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return seconds < 0 ? `-${text}` : text
}

function routeLabel (route: TripTableRoute | undefined): string {
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
  good: number
  ok: number
  long_wait: number
  good_or_ok_share: number
  median_wait: string
}

export function transferSummaryRows (summaries: TransferPairSummary[], routes: Map<number, TripTableRoute>): TransferSummaryRow[] {
  return summaries.map((s) => {
    const from = routes.get(s.fromRouteId)
    const to = routes.get(s.toRouteId)
    return {
      from_route_id: from?.route_id ?? '',
      from_route_name: routeLabel(from),
      from_route_color: from?.route_color ?? '',
      from_route_text_color: from?.route_text_color ?? '',
      from_agency_name: from?.agency_name ?? '',
      from_direction_id: s.fromDirectionId,
      from_headsign: s.fromHeadsign,
      to_route_id: to?.route_id ?? '',
      to_route_name: routeLabel(to),
      to_route_color: to?.route_color ?? '',
      to_route_text_color: to?.route_text_color ?? '',
      to_agency_name: to?.agency_name ?? '',
      to_direction_id: s.toDirectionId,
      to_headsign: s.toHeadsign,
      arrivals: s.arrivals,
      missed: s.missed,
      good: s.good,
      ok: s.ok,
      long_wait: s.long,
      good_or_ok_share: Math.round(s.goodOrOkShare * 1000) / 10,
      median_wait: formatWait(s.medianWait),
    }
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
  grade: string
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
    const { date, seconds } = calendarTime(arrival.time)
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
        grade: 'No connection',
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
        grade: TRANSFER_GRADE_LABELS[c.grade],
      })
    }
  }
  return rows
}

// The trips whose details the transfers need: those at the stops from the
// window's start to its end plus the longest wait and walk, on the dates and
// the day after each.
export function transferTripIds (opts: {
  stopIds: number[]
  dates: string[]
  startTime: number
  endTime: number
  stopDepartureCache: StopDepartureCache
  maxWalkSeconds: number
  breakpoints?: readonly number[]
}): number[] {
  const bp = opts.breakpoints ?? TRANSFER_GRADE_BREAKPOINTS
  const until = opts.endTime + opts.maxWalkSeconds + bp[bp.length - 1]!
  const ids = new Set<number>()
  // A departure early in a day may connect from an arrival late the day
  // before, so it is also read a day later.
  const wanted = (t: number) => (t >= opts.startTime && t <= until) || (t + SECONDS_PER_DAY >= opts.startTime && t + SECONDS_PER_DAY <= until)
  for (const date of departureDates(opts.dates)) {
    for (const stopId of opts.stopIds) {
      for (const st of opts.stopDepartureCache.get(stopId, date)) {
        if (wanted(st.departureTime % SECONDS_PER_DAY)) {
          ids.add(st.tripId)
        }
      }
    }
  }
  return [...ids]
}
