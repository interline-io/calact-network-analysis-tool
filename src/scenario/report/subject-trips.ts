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
import { WEEKDAY_BY_GETDAY, dowValues, formatGtfsTimeFull, parseCalendarDate, type TableColumn, type Weekday } from '../../core'
import type { RouteDepartureIndex, StopDepartureCache } from '../../tl/departure-cache'
import { tripHeadsignAt, type TripDetail } from '../../tl/trip-details'
import { routeTripsOnDate } from '../route-headway'

// The map feature a trip panel describes. A cluster is named by id only: its
// members follow the filters, so they are looked up when needed.
export type TripSubject
  = | { kind: 'stop', stopId: number }
    | { kind: 'cluster', clusterId: string }
    | { kind: 'route', routeId: number }

// A subject with a cluster's current members filled in.
export type ResolvedTripSubject
  = | Exclude<TripSubject, { kind: 'cluster' }>
    | { kind: 'cluster', clusterId: string, stopIds: number[] }

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
  // count / (hours in the time-of-day window * dateCount); undefined with no
  // dates.
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

export function subjectTrips (subject: ResolvedTripSubject, opts: SubjectTripsOptions): SubjectTrips {
  const dateStrs = opts.dates.map(d => format(d, 'yyyy-MM-dd'))
  const rows = new Map<string, SubjectTripRow>()
  const routeCounts = new Map<number, number>()
  let count = 0
  let firstTime: number | undefined
  let lastTime: number | undefined

  // One visit (or trip) on one date; a row already seen gains the date.
  function add (visit: Omit<SubjectTripRow, 'dates'>, date: string) {
    count += 1
    routeCounts.set(visit.routeId, (routeCounts.get(visit.routeId) || 0) + 1)
    if (firstTime === undefined || visit.time < firstTime) {
      firstTime = visit.time
    }
    if (lastTime === undefined || visit.time > lastTime) {
      lastTime = visit.time
    }
    const row = rows.get(visit.key)
    if (row) {
      row.dates.push(date)
    } else {
      rows.set(visit.key, { ...visit, dates: [date] })
    }
  }

  if (subject.kind === 'route') {
    const routeIndex = opts.routeIndex
    for (const date of routeIndex ? dateStrs : []) {
      // The trips calculateRouteTripStats counts, timed at their first
      // in-bbox departure.
      for (const [tripId, t] of routeTripsOnDate(routeIndex!, subject.routeId, date, opts.startTime, opts.endTime)) {
        if (t.inWindow) {
          add({ key: `${tripId}|${t.first}`, tripId, routeId: subject.routeId, directionId: t.directionId, stopId: t.firstStopId, time: t.first }, date)
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
          add({ key: `${st.tripId}|${stopId}|${st.departureTime}`, tripId: st.tripId, routeId: st.routeId, directionId: st.directionId, stopId, time: st.departureTime }, date)
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
    averagePerHour: denominator > 0 ? count / denominator : undefined,
    firstTime,
    lastTime,
    routeCounts: [...routeCounts]
      .map(([routeId, n]) => ({ routeId, count: n }))
      .sort((a, b) => b.count - a.count || a.routeId - b.routeId),
    rows: [...rows.values()].sort((a, b) => a.time - b.time || a.routeId - b.routeId || a.tripId - b.tripId),
  }
}

// "monday" as "Mon".
function weekdayShort (day: Weekday): string {
  return day.charAt(0).toUpperCase() + day.slice(1, 3)
}

/**
 * Says the days a row runs the way a printed timetable says them: its weekdays
 * ("Mon–Fri", "Sat, Sun", "Every day") when it runs on every scoped date of
 * those weekdays, and otherwise how many of the dates ("3 of 10 days").
 *
 * Built once per set of scoped dates: each date's weekday is worked out once,
 * and a set of dates already described (most rows share a few: weekdays,
 * weekends) is not described again.
 */
export function rowDaysDescriber (scopedDates: string[]): (rowDates: string[]) => string {
  const weekdayOf = new Map<string, Weekday>()
  for (const d of scopedDates) {
    weekdayOf.set(d, WEEKDAY_BY_GETDAY[parseCalendarDate(d)!.getDay()]!)
  }
  const said = new Map<string, string>()
  return (rowDates) => {
    const memoKey = rowDates.join(',')
    let text = said.get(memoKey)
    if (text === undefined) {
      text = describe(new Set(rowDates))
      said.set(memoKey, text)
    }
    return text
  }

  function describe (runs: Set<string>): string {
    const ran = scopedDates.filter(d => runs.has(d))
    const weekdays = new Set(ran.map(d => weekdayOf.get(d)!))
    if (!scopedDates.every(d => !weekdays.has(weekdayOf.get(d)!) || runs.has(d))) {
      return `${ran.length} of ${scopedDates.length} days`
    }
    if (weekdays.size === dowValues.length) {
      return 'Every day'
    }
    // Runs of consecutive weekdays: Mon, Tue, Wed, Fri as "Mon–Wed, Fri".
    const parts: string[] = []
    let run: Weekday[] = []
    for (const day of [...dowValues, undefined]) {
      if (day && weekdays.has(day)) {
        run.push(day)
        continue
      }
      if (run.length >= 3) {
        parts.push(`${weekdayShort(run[0]!)}–${weekdayShort(run[run.length - 1]!)}`)
      } else {
        parts.push(...run.map(weekdayShort))
      }
      run = []
    }
    return parts.join(', ')
  }
}

// One row's days, for a single description; rowDaysDescriber for many rows.
export function describeRowDays (rowDates: string[], scopedDates: string[]): string {
  return rowDaysDescriber(scopedDates)(rowDates)
}

// The trip table's rows (the full-size table and its CSV download). Each row is
// a whole CSV record; the table shows a subset of the columns, so the download
// keeps what the table leaves out, such as the direction and every date.
export interface TripTableRoute {
  route_id: string
  route_short_name?: string | null
  route_long_name?: string | null
  route_color?: string | null
  route_text_color?: string | null
  agency_name?: string | null
}

export interface TripTableStop {
  stop_id: string
  stop_name?: string | null
}

export interface TripTableRow {
  time: string
  stop_id: string
  stop_name: string
  route_id: string
  route_short_name: string
  route_long_name: string
  // GTFS colors, for the table's route badge; harmless in the CSV.
  route_color: string
  route_text_color: string
  agency_name: string
  headsign: string
  direction_id: number
  trip_id: string
  trip_start: string
  trip_end: string
  stop_count: number | ''
  days: string
  dates: string
}

export function tripTableRows (
  rows: SubjectTripRow[],
  opts: {
    routes: Map<number, TripTableRoute>
    stops: Map<number, TripTableStop>
    tripDetails: Map<number, TripDetail>
    scopedDates: string[]
  },
): TripTableRow[] {
  const describeDays = rowDaysDescriber(opts.scopedDates)
  return rows.map((row) => {
    const route = opts.routes.get(row.routeId)
    const stop = opts.stops.get(row.stopId)
    const detail = opts.tripDetails.get(row.tripId)
    return {
      time: formatGtfsTimeFull(row.time),
      stop_id: stop?.stop_id ?? '',
      stop_name: stop?.stop_name ?? '',
      route_id: route?.route_id ?? '',
      route_short_name: route?.route_short_name ?? '',
      route_long_name: route?.route_long_name ?? '',
      route_color: route?.route_color ?? '',
      route_text_color: route?.route_text_color ?? '',
      agency_name: route?.agency_name ?? '',
      headsign: (detail && tripHeadsignAt(detail, row.stopId)) || '',
      direction_id: row.directionId,
      trip_id: detail?.tripId ?? '',
      trip_start: detail?.startTime != null ? formatGtfsTimeFull(detail.startTime) : '',
      trip_end: detail?.endTime != null ? formatGtfsTimeFull(detail.endTime) : '',
      stop_count: detail ? detail.stopCount : '',
      days: describeDays(row.dates),
      // Space-separated, so the CSV keeps one row per trip.
      dates: row.dates.join(' '),
    }
  })
}

export function tripTableColumns (subjectKind: TripSubject['kind'], multiDay: boolean): TableColumn[] {
  const cols: TableColumn[] = [
    {
      key: 'time',
      label: 'Time',
      sortable: true,
      tooltip: subjectKind === 'route'
        ? 'When the trip leaves its first stop within the scenario area.'
        : 'When the trip leaves this stop.',
    },
  ]
  if (subjectKind === 'cluster') {
    cols.push({ key: 'stop_name', label: 'Stop', sortable: true })
  }
  cols.push(
    { key: 'route_short_name', label: 'Route', sortable: true },
    { key: 'headsign', label: 'Headsign', sortable: true },
    {
      key: 'trip_start',
      label: 'Trip',
      sortable: true,
      tooltip: 'When the trip leaves its first stop and reaches its last, including stops outside the scenario area.',
    },
    {
      key: 'stop_count',
      label: 'Stops',
      sortable: true,
      numeric: true,
      tooltip: 'Stops the whole trip makes, including stops outside the scenario area.',
    },
  )
  if (multiDay) {
    cols.push({ key: 'days', label: 'Days', sortable: true })
  }
  cols.push({ key: 'trip_id', label: 'Trip ID', sortable: true })
  return cols
}
