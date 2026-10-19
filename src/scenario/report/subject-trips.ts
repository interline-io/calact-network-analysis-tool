/**
 * The trips behind a map feature's "Show trip information" panel (#476): every
 * trip that visits a stop, a stop cluster, or runs a route, within the
 * scenario's dates, weekdays, and time-of-day window.
 *
 * Counted the way the reports count, so the panel never disagrees with them:
 * - a stop or cluster counts visits as `stopVisits` does (each in-window
 *   departure at a member stop, on each scoped date), which is the Stops
 *   report's "Total Visits During Time Period";
 * - a route counts trips as `calculateRouteTripStats` does (a trip is in when
 *   any of its in-bbox departures falls in the window), which feeds the Routes
 *   report's trips per day.
 *
 * A trip that runs the same times on several dates is one row, with the dates
 * it runs on, so a two-week scenario reads like a timetable rather than
 * repeating each trip fourteen times.
 */

import { format } from 'date-fns'
import { WEEKDAY_BY_GETDAY, type Weekday } from '../../core'
import type { RouteDepartureIndex, StopDepartureCache } from '../../tl/departure-cache'

export type TripSubject
  = | { kind: 'stop', stopId: number }
    | { kind: 'cluster', clusterId: string, stopIds: number[] }
    | { kind: 'route', routeId: number }

export interface SubjectTripRow {
  key: string
  tripId: number
  routeId: number
  directionId: number
  // The stop the time is at: the visited stop for a stop or cluster, and the
  // trip's first stop within the scenario area for a route.
  stopId: number
  time: number
  // Calendar dates (yyyy-MM-dd) the row runs on, in date order.
  dates: string[]
}

export interface SubjectRouteCount {
  routeId: number
  count: number
}

export interface SubjectTrips {
  // Visits for a stop or cluster; trips for a route. Summed over dates.
  count: number
  // Scoped calendar dates, not service days, as the reports divide by.
  dateCount: number
  // Hours in the time-of-day window; 24 in all-day mode.
  hoursInWindow: number
  // count / (hoursInWindow * dateCount); undefined with no dates.
  averagePerHour?: number
  firstTime?: number
  lastTime?: number
  // Per route, most first. A route subject has its one route.
  routeCounts: SubjectRouteCount[]
  rows: SubjectTripRow[]
}

export interface SubjectTripsOptions {
  // The scenario's date range already scoped to the effective weekdays
  // (scopeDatesToWeekdays), as the reports use it.
  dates: Date[]
  startTime: number
  endTime: number
  stopDepartureCache: StopDepartureCache
  // Needed for a route subject; built from the same cache.
  routeIndex?: RouteDepartureIndex
}

export function subjectTrips (subject: TripSubject, opts: SubjectTripsOptions): SubjectTrips {
  const dateStrs = opts.dates.map(d => format(d, 'yyyy-MM-dd'))
  const rows = new Map<string, SubjectTripRow>()
  const routeCounts = new Map<number, number>()
  let count = 0
  let firstTime: number | undefined
  let lastTime: number | undefined

  function add (key: string, tripId: number, routeId: number, directionId: number, stopId: number, time: number, date: string) {
    count += 1
    routeCounts.set(routeId, (routeCounts.get(routeId) || 0) + 1)
    if (firstTime === undefined || time < firstTime) {
      firstTime = time
    }
    if (lastTime === undefined || time > lastTime) {
      lastTime = time
    }
    const row = rows.get(key)
    if (row) {
      row.dates.push(date)
    } else {
      rows.set(key, { key, tripId, routeId, directionId, stopId, time, dates: [date] })
    }
  }

  if (subject.kind === 'route') {
    const routeIndex = opts.routeIndex
    for (const date of dateStrs) {
      if (!routeIndex) {
        break
      }
      for (const dir of [0, 1]) {
        // Each trip's earliest in-bbox departure, and whether any of its
        // departures falls in the window (calculateRouteTripStats' rule).
        const trips = new Map<number, { time: number, stopId: number, inWindow: boolean }>()
        for (const [stopId, deps] of routeIndex.getRouteDate(subject.routeId, dir, date)) {
          for (const st of deps) {
            const inWindow = st.departureTime >= opts.startTime && st.departureTime <= opts.endTime
            const t = trips.get(st.tripId)
            if (!t) {
              trips.set(st.tripId, { time: st.departureTime, stopId, inWindow })
              continue
            }
            if (st.departureTime < t.time) {
              t.time = st.departureTime
              t.stopId = stopId
            }
            t.inWindow ||= inWindow
          }
        }
        for (const [tripId, t] of trips) {
          if (t.inWindow) {
            add(`${tripId}|${t.time}`, tripId, subject.routeId, dir, t.stopId, t.time, date)
          }
        }
      }
    }
  } else {
    const stopIds = subject.kind === 'stop' ? [subject.stopId] : subject.stopIds
    for (const date of dateStrs) {
      for (const stopId of stopIds) {
        for (const st of opts.stopDepartureCache.get(stopId, date)) {
          // Inclusive at both ends, as stopVisits counts.
          if (st.departureTime < opts.startTime || st.departureTime > opts.endTime) {
            continue
          }
          add(`${st.tripId}|${stopId}|${st.departureTime}`, st.tripId, st.routeId, st.directionId, stopId, st.departureTime, date)
        }
      }
    }
  }

  const hoursInWindow = (opts.endTime - opts.startTime) / 3600
  const dateCount = dateStrs.length
  const denominator = hoursInWindow * dateCount
  return {
    count,
    dateCount,
    hoursInWindow,
    averagePerHour: denominator > 0 ? count / denominator : undefined,
    firstTime,
    lastTime,
    routeCounts: [...routeCounts]
      .map(([routeId, n]) => ({ routeId, count: n }))
      .sort((a, b) => b.count - a.count || a.routeId - b.routeId),
    rows: [...rows.values()].sort((a, b) => a.time - b.time || a.routeId - b.routeId || a.tripId - b.tripId),
  }
}

const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

const WEEK: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

function weekdayOf (date: string): Weekday {
  // Noon, so no timezone offset can move the date.
  return WEEKDAY_BY_GETDAY[new Date(`${date}T12:00:00`).getDay()]!
}

/**
 * The days a row runs, said the way a printed timetable says them: its
 * weekdays ("Mon–Fri", "Sat, Sun", "Every day") when it runs on every scoped
 * date of those weekdays, and otherwise how many of the dates ("3 of 10 days").
 */
export function describeRowDays (rowDates: string[], scopedDates: string[]): string {
  const runs = new Set(rowDates)
  const ran = scopedDates.filter(d => runs.has(d))
  const weekdays = new Set(ran.map(weekdayOf))
  const everyOfWeekday = scopedDates.every(d => !weekdays.has(weekdayOf(d)) || runs.has(d))
  if (!everyOfWeekday) {
    return `${ran.length} of ${scopedDates.length} days`
  }
  if (weekdays.size === WEEK.length) {
    return 'Every day'
  }
  return weekdayRanges(WEEK.filter(w => weekdays.has(w)))
}

// Consecutive weekdays as a range: Mon, Tue, Wed, Fri as "Mon–Wed, Fri".
function weekdayRanges (days: Weekday[]): string {
  const parts: string[] = []
  let i = 0
  while (i < days.length) {
    let j = i
    while (j + 1 < days.length && WEEK.indexOf(days[j + 1]!) === WEEK.indexOf(days[j]!) + 1) {
      j++
    }
    const from = WEEKDAY_SHORT[days[i]!]
    const to = WEEKDAY_SHORT[days[j]!]
    if (j - i >= 2) {
      parts.push(`${from}–${to}`)
    } else if (j > i) {
      parts.push(`${from}, ${to}`)
    } else {
      parts.push(from)
    }
    i = j + 1
  }
  return parts.join(', ')
}
