import { describe, it, expect } from 'vitest'
import { StopDepartureCache, RouteDepartureIndex } from '../../tl/departure-cache'
import { describeRowDays, subjectTrips, tripTableColumns, tripTableRows, tripTimeLabel } from './subject-trips'

// 2026-10-19 is a Monday.
const MON = '2026-10-19'
const TUE = '2026-10-20'
const SAT = '2026-10-24'
const SUN = '2026-10-25'

function day (s: string): Date {
  return new Date(`${s}T00:00:00`)
}

function hms (h: number, m = 0): number {
  return h * 3600 + m * 60
}

// stopId, date, departure, tripId, directionId, routeId
type Dep = [number, string, number, number, number, number]

function cacheOf (deps: Dep[]): StopDepartureCache {
  const cache = new StopDepartureCache()
  for (const [stopId, date, time, tripId, dir, routeId] of deps) {
    cache.addFromWire(stopId, date, time, tripId, dir, routeId)
  }
  return cache
}

describe('subjectTrips', () => {
  it('counts a stop\'s in-window visits as the Stops report does, one row per repeated trip', () => {
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [1, TUE, hms(7), 100, 0, 10],
      [1, MON, hms(8), 101, 1, 11],
      // Out of the window.
      [1, MON, hms(22), 102, 0, 10],
      // Another stop.
      [2, MON, hms(7), 200, 0, 10],
    ])
    const r = subjectTrips({ kind: 'stop', stopId: 1 }, {
      dates: [day(MON), day(TUE)],
      startTime: hms(6),
      endTime: hms(10),
      stopDepartureCache: cache,
    })
    expect(r.count).toBe(3)
    expect(r.dateCount).toBe(2)
    expect(r.averagePerHour).toBeCloseTo(3 / (4 * 2))
    expect(r.firstTime).toBe(hms(7))
    expect(r.lastTime).toBe(hms(8))
    expect(r.routeCounts).toEqual([{ routeId: 10, count: 2 }, { routeId: 11, count: 1 }])
    expect(r.rows.map(row => [row.tripId, row.dates])).toEqual([
      [100, [MON, TUE]],
      [101, [MON]],
    ])
  })

  it('includes window boundaries, as stopVisits does', () => {
    const cache = cacheOf([
      [1, MON, hms(6), 100, 0, 10],
      [1, MON, hms(10), 101, 0, 10],
    ])
    const r = subjectTrips({ kind: 'stop', stopId: 1 }, {
      dates: [day(MON)],
      startTime: hms(6),
      endTime: hms(10),
      stopDepartureCache: cache,
    })
    expect(r.count).toBe(2)
  })

  it('pools a cluster\'s member stops, keeping each visit to its stop', () => {
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [2, MON, hms(7, 5), 200, 0, 20],
      [3, MON, hms(7, 10), 300, 0, 30],
    ])
    const r = subjectTrips({ kind: 'cluster', clusterId: 'c1', stopIds: [1, 2] }, {
      dates: [day(MON)],
      startTime: 0,
      endTime: hms(24),
      stopDepartureCache: cache,
    })
    expect(r.count).toBe(2)
    expect(r.rows.map(row => [row.stopId, row.routeId])).toEqual([[1, 10], [2, 20]])
  })

  it('counts a route\'s trips by any in-window departure, timed at the first in-area stop', () => {
    const cache = cacheOf([
      // Trip 100 starts before the window and reaches stop 2 inside it.
      [1, MON, hms(5, 50), 100, 0, 10],
      [2, MON, hms(6, 10), 100, 0, 10],
      // Trip 101 runs entirely after the window.
      [1, MON, hms(11), 101, 0, 10],
      // Trip 102 runs the other way.
      [2, MON, hms(7), 102, 1, 10],
      [1, MON, hms(7, 20), 102, 1, 10],
    ])
    const r = subjectTrips({ kind: 'route', routeId: 10 }, {
      dates: [day(MON)],
      startTime: hms(6),
      endTime: hms(10),
      stopDepartureCache: cache,
      routeIndex: RouteDepartureIndex.fromCache(cache),
    })
    expect(r.count).toBe(2)
    expect(r.rows.map(row => [row.tripId, row.stopId, row.time, row.directionId])).toEqual([
      [100, 1, hms(5, 50), 0],
      [102, 2, hms(7), 1],
    ])
  })
})

describe('describeRowDays', () => {
  const week = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', SAT, SUN]

  it('names every day', () => {
    expect(describeRowDays(week, week)).toBe('Every day')
  })

  it('names a run of weekdays as a range', () => {
    expect(describeRowDays(week.slice(0, 5), week)).toBe('Mon–Fri')
  })

  it('names two days apart from a range', () => {
    expect(describeRowDays([SAT, SUN], week)).toBe('Sat, Sun')
    expect(describeRowDays([MON, TUE, SUN], week)).toBe('Mon, Tue, Sun')
  })

  it('counts dates when the row misses some of its weekdays', () => {
    const twoWeeks = [...week, '2026-10-26']
    expect(describeRowDays([MON], twoWeeks)).toBe('1 of 8 days')
  })

  it('names the weekdays of a weekday-scoped range rather than every day', () => {
    const weekdays = week.slice(0, 5)
    expect(describeRowDays(weekdays, weekdays)).toBe('Mon–Fri')
  })
})

describe('tripTableRows', () => {
  it('writes each row as a full CSV record, blank where details have not loaded', () => {
    const rows = tripTableRows([
      { key: 'a', tripId: 100, routeId: 10, directionId: 1, stopId: 1, time: hms(7, 35), dates: [MON, TUE] },
      { key: 'b', tripId: 101, routeId: 10, directionId: 0, stopId: 1, time: hms(8), dates: [MON] },
    ], {
      routes: new Map([[10, { route_id: 'R10', route_short_name: '10', route_long_name: 'Tenth', agency_name: 'TriMet' }]]),
      stops: new Map([[1, { stop_id: 'S1', stop_name: 'Main & 1st' }]]),
      tripDetails: new Map([[100, { id: 100, tripId: 't100', headsign: 'Downtown', stopHeadsigns: new Map(), startTime: hms(7), endTime: hms(8, 5), stopCount: 30 }]]),
      scopedDates: [MON, TUE],
    })
    expect(rows[0]).toEqual({
      time: '07:35:00',
      stop_id: 'S1',
      stop_name: 'Main & 1st',
      route_id: 'R10',
      route_short_name: '10',
      route_long_name: 'Tenth',
      route_color: '',
      route_text_color: '',
      agency_name: 'TriMet',
      headsign: 'Downtown',
      direction_id: 1,
      trip_id: 't100',
      trip_start: '07:00:00',
      trip_end: '08:05:00',
      stop_count: 30,
      days: 'Mon, Tue',
      dates: `${MON} ${TUE}`,
    })
    expect(rows[1]).toMatchObject({ headsign: '', trip_id: '', trip_start: '', stop_count: '', days: 'Mon' })
  })
})

describe('tripTableColumns', () => {
  it('adds a Stop column for a cluster and Days for more than one date', () => {
    expect(tripTableColumns('cluster', true).map(c => c.key)).toEqual(
      ['time', 'stop_name', 'route_short_name', 'headsign', 'trip_start', 'stop_count', 'days', 'trip_id'],
    )
    expect(tripTableColumns('stop', false).map(c => c.key)).toEqual(
      ['time', 'route_short_name', 'headsign', 'trip_start', 'stop_count', 'trip_id'],
    )
  })
})

describe('tripTimeLabel', () => {
  it('drops the seconds and keeps after-midnight hours', () => {
    expect(tripTimeLabel('07:35:00')).toBe('07:35')
    expect(tripTimeLabel('25:10:00')).toBe('25:10')
  })
})
