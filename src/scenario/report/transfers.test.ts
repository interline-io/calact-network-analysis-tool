import { describe, it, expect } from 'vitest'
import { StopDepartureCache } from '../../tl/departure-cache'
import type { TripDetail, TripStopTime } from '../../tl/trip-details'
import {
  calculateTransfers,
  calendarTime,
  dayNumber,
  dayString,
  filterTransferGroups,
  formatWait,
  summarizeTransfers,
  transferEvents,
  transferGrade,
  transferGradeCounts,
  transferOverview,
  transferRows,
  transferTripChoices,
  transferTripIds,
  transferTripKey,
  type TransferEvent,
} from './transfers'

// 2026-10-19 is a Monday.
const MON = '2026-10-19'
const TUE = '2026-10-20'

function hms (h: number, m = 0): number {
  return h * 3600 + m * 60
}

// stopId, date, departure, tripId, directionId, routeId, pickupType
type Dep = [number, string, number, number, number, number, number?]

function cacheOf (deps: Dep[]): StopDepartureCache {
  const cache = new StopDepartureCache()
  for (const [stopId, date, time, tripId, dir, routeId, pickup] of deps) {
    cache.addFromWire(stopId, date, time, tripId, dir, routeId, pickup ?? null)
  }
  return cache
}

function detail (id: number, stopTimes: TripStopTime[], headsign = `Trip ${id}`): TripDetail {
  return { id, tripId: `t${id}`, headsign, stopHeadsigns: new Map(), stopCount: stopTimes.length, stopTimes }
}

function at (time: number, date = MON): number {
  return dayNumber(date) * 86400 + time
}

function event (tripId: number, routeId: number, time: number, stopId = 1, directionId = 0): TransferEvent {
  return { tripId, routeId, directionId, stopId, serviceDate: MON, time: at(time) }
}

const walk = { walkSeconds: (a: number, b: number) => (a === b ? 0 : 120), maxWalkSeconds: 120 }

describe('dates and times', () => {
  it('round-trips day numbers and reads an absolute time\'s calendar date', () => {
    expect(dayString(dayNumber(MON))).toBe(MON)
    expect(dayString(dayNumber(MON) + 1)).toBe(TUE)
    expect(calendarTime(at(hms(24, 10)))).toEqual({ date: TUE, seconds: hms(0, 10) })
  })

  it('formats waits as minutes and seconds, signed when missed', () => {
    expect(formatWait(270)).toBe('4m 30s')
    expect(formatWait(-75)).toBe('-1m 15s')
    expect(formatWait(0)).toBe('0s')
    expect(formatWait(undefined)).toBe('')
  })
})

describe('transferGrade', () => {
  it('grades by the default breakpoints, lower bound inclusive', () => {
    expect(transferGrade(-60)).toBe('missed')
    expect(transferGrade(0)).toBe('good')
    expect(transferGrade(hms(0, 6))).toBe('ok')
    expect(transferGrade(hms(0, 10))).toBe('long')
    expect(transferGrade(hms(0, 20))).toBe('long')
  })
})

describe('transferEvents', () => {
  it('arrives where a trip lets riders off and departs where it picks them up', () => {
    const cache = cacheOf([
      // Trip 100 runs through stop 1 (its second stop), 07:00 departure after a
      // 1 minute dwell.
      [1, MON, hms(7), 100, 0, 10],
      // Trip 200 starts at stop 1: it departs but does not arrive.
      [1, MON, hms(7, 5), 200, 0, 20],
      // Trip 300 ends at stop 2: it arrives but does not depart.
      [2, MON, hms(7, 10), 300, 0, 30],
      // Trip 400 is drop-off only at stop 1 (no pickup).
      [1, MON, hms(7, 15), 400, 0, 40, 1],
    ])
    const tripDetails = new Map([
      [100, detail(100, [{ stopId: 9, departure: hms(6, 50) }, { stopId: 1, arrival: hms(6, 59), departure: hms(7) }, { stopId: 8, arrival: hms(7, 20) }])],
      [200, detail(200, [{ stopId: 1, departure: hms(7, 5) }, { stopId: 8, arrival: hms(7, 30) }])],
      [300, detail(300, [{ stopId: 9, departure: hms(6, 40) }, { stopId: 2, arrival: hms(7, 10), departure: hms(7, 10) }])],
      [400, detail(400, [{ stopId: 9, departure: hms(7) }, { stopId: 1, arrival: hms(7, 15), departure: hms(7, 15), pickupType: 1 }, { stopId: 8, arrival: hms(7, 30) }])],
    ])
    const events = transferEvents({ stopIds: [1, 2], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails })
    expect(events.arrivals.map(e => [e.tripId, calendarTime(e.time).seconds])).toEqual([
      [100, hms(6, 59)],
      [300, hms(7, 10)],
      [400, hms(7, 15)],
    ])
    expect(events.departures.map(e => e.tripId)).toEqual([100, 200])
    expect(events.missingDetails).toBe(0)
  })

  it('counts a trip at several of the stops once: arriving at the first, leaving from the last', () => {
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [2, MON, hms(7, 2), 100, 0, 10],
    ])
    const tripDetails = new Map([
      [100, detail(100, [{ stopId: 9, departure: hms(6, 50) }, { stopId: 1, arrival: hms(7), departure: hms(7) }, { stopId: 2, arrival: hms(7, 2), departure: hms(7, 2) }, { stopId: 8, arrival: hms(7, 9) }])],
    ])
    const events = transferEvents({ stopIds: [1, 2], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails })
    expect(events.arrivals.map(e => [e.stopId, calendarTime(e.time).seconds])).toEqual([[1, hms(7)]])
    expect(events.departures.map(e => [e.stopId, calendarTime(e.time).seconds])).toEqual([[2, hms(7, 2)]])
  })

  it('reads a departure past midnight on its service day, and counts arrivals only in the window', () => {
    const cache = cacheOf([
      // Monday's late trip arrives at 23:55.
      [1, MON, hms(23, 55), 100, 0, 10],
      // Monday's trip 200 leaves at 24:05, stored on Tuesday.
      [1, TUE, hms(24, 5), 200, 0, 20],
      // A morning arrival outside a 20:00 to 24:00 window.
      [1, MON, hms(8), 300, 0, 30],
    ])
    const through = (id: number, t: number) => detail(id, [{ stopId: 9, departure: t - 600 }, { stopId: 1, arrival: t, departure: t }, { stopId: 8, arrival: t + 600 }])
    const tripDetails = new Map([[100, through(100, hms(23, 55))], [200, through(200, hms(24, 5))], [300, through(300, hms(8))]])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: hms(20), endTime: hms(24), stopDepartureCache: cache, tripDetails })
    expect(events.arrivals.map(e => e.tripId)).toEqual([100])
    const [group] = calculateTransfers(events.arrivals, events.departures, walk)
    expect(group!.connections.map(c => [c.departure.tripId, c.wait])).toEqual([[200, 600]])
    expect(events.departures.find(e => e.tripId === 200)?.serviceDate).toBe(MON)
  })

  it('leaves out trips whose details have not arrived', () => {
    const cache = cacheOf([[1, MON, hms(7), 100, 0, 10]])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails: new Map() })
    expect(events.arrivals).toEqual([])
    expect(events.missingDetails).toBe(1)
  })
})

describe('calculateTransfers', () => {
  it('pairs an arrival with departures on other routes, walking between stops', () => {
    const [group] = calculateTransfers([event(1, 10, hms(7))], [
      // The same trip, and the same route either way, are not transfers.
      event(1, 10, hms(7, 1)),
      event(2, 10, hms(7, 3)),
      event(3, 10, hms(7, 4), 1, 1),
      // Another route at the same stop is.
      event(7, 50, hms(7, 4)),
      // At another stop, 2 minutes' walk: a 3 minute wait.
      event(4, 20, hms(7, 5), 2),
      // Outside -5 to 20 minutes.
      event(5, 30, hms(6, 50)),
      event(6, 40, hms(7, 25)),
    ], walk)
    expect(group!.connections.map(c => [c.departure.tripId, c.walk, c.wait, c.grade])).toEqual([
      [4, 120, hms(0, 3), 'good'],
      [7, 0, hms(0, 4), 'good'],
    ])
  })

  it('shows the first connection made on each route and direction, and any missed before it', () => {
    const deps = [
      event(2, 20, hms(6, 58)),
      event(3, 20, hms(7, 4)),
      event(4, 20, hms(7, 12)),
      event(5, 30, hms(7, 8)),
    ]
    const [first] = calculateTransfers([event(1, 10, hms(7))], deps, walk)
    expect(first!.connections.map(c => [c.departure.tripId, c.grade])).toEqual([
      [2, 'missed'],
      [3, 'good'],
      [5, 'ok'],
    ])
    const [all] = calculateTransfers([event(1, 10, hms(7))], deps, { ...walk, allConnections: true })
    expect(all!.connections.map(c => c.departure.tripId)).toEqual([2, 3, 5, 4])
  })

  it('leaves out stops whose walk between them is not known', () => {
    const [group] = calculateTransfers([event(1, 10, hms(7))], [event(2, 20, hms(7, 5), 2), event(3, 30, hms(7, 6))], {
      walkSeconds: (a, b) => (a === b ? 0 : Number.NaN),
      maxWalkSeconds: 0,
    })
    expect(group!.connections.map(c => c.departure.tripId)).toEqual([3])
  })

  it('takes other breakpoints', () => {
    const [group] = calculateTransfers([event(1, 10, hms(7))], [event(2, 20, hms(7, 25))], { ...walk, breakpoints: [-600, 0, 600, 1200, 1800] })
    expect(group!.connections.map(c => c.grade)).toEqual(['long'])
  })
})

describe('summarizeTransfers and transferGradeCounts', () => {
  const arrivals = [event(1, 10, hms(7)), event(2, 10, hms(7, 30)), event(3, 10, hms(8))]
  const departures = [
    // Good after the first arrival, long after the second, none after the third.
    event(11, 20, hms(7, 3)),
    event(12, 20, hms(7, 45)),
  ]
  const groups = calculateTransfers(arrivals, departures, walk)

  it('totals connections by route pair against every arrival on the incoming route', () => {
    const [row] = summarizeTransfers(groups)
    expect(row).toMatchObject({ fromRouteId: 10, toRouteId: 20, arrivals: 3, good: 1, long: 1, missed: 0, ok: 0 })
    expect(row!.goodOrOkShare).toBeCloseTo(1 / 3)
    expect(row!.goodShare).toBeCloseTo(1 / 3)
    expect(row!.okShare).toBe(0)
    expect(row!.medianWait).toBe((hms(0, 3) + hms(0, 15)) / 2)
  })

  it('sums up every arrival by its soonest connection', () => {
    expect(transferOverview(groups)).toEqual({ arrivals: 3, connections: 2, goodOrOkShare: 1 / 3, medianWait: (hms(0, 3) + hms(0, 15)) / 2 })
  })

  it('counts connections by grade', () => {
    expect(transferGradeCounts(groups).map(c => [c.grade, c.count])).toEqual([['missed', 0], ['good', 1], ['ok', 0], ['long', 1]])
  })

  it('writes a row per connection, and one for an arrival with none', () => {
    const rows = transferRows(groups, { routes: new Map(), stops: new Map(), tripDetails: new Map() })
    expect(rows.map(r => [r.arrival_time, r.departure_time, r.grade])).toEqual([
      ['07:00:00', '07:03:00', 'Good'],
      ['07:30:00', '07:45:00', 'Long wait'],
      ['08:00:00', '', 'No connection'],
    ])
  })
})

describe('filterTransferGroups', () => {
  it('keeps arrivals on a date and in a time band', () => {
    const groups = calculateTransfers([event(1, 10, hms(6, 30)), event(2, 10, hms(8)), event(3, 10, hms(8) + 86400)], [], walk)
    expect(filterTransferGroups(groups, undefined, 'all').length).toBe(3)
    expect(filterTransferGroups(groups, undefined, 'am').map(g => g.arrival.tripId)).toEqual([2, 3])
    expect(filterTransferGroups(groups, MON, 'am').map(g => g.arrival.tripId)).toEqual([2])
    expect(filterTransferGroups(groups, TUE, 'early').length).toBe(0)
  })
})

describe('transferTripChoices', () => {
  const trip = (routeId: number, directionId: number, headsign?: string): TransferEvent => ({ ...event(1, routeId, 0, 1, directionId), headsign })
  const routes = new Map([
    [10, { route_id: 'R10', route_short_name: '10', route_long_name: 'Tenth', route_sort_order: 2 }],
    [20, { route_id: 'R20', route_short_name: '2', route_long_name: 'Second', route_sort_order: 1 }],
    [30, { route_id: 'R30', route_short_name: 'Loop', route_long_name: 'Downtown Loop' }],
  ])

  it('groups trips by route, direction, and destination, naming a direction by its majority destination', () => {
    const [second, tenth, loop] = transferTripChoices([
      trip(10, 0, 'Downtown'), trip(10, 0, 'Downtown'), trip(10, 0, 'Midtown'),
      trip(10, 1, 'Airport'), trip(10, 1, 'Zoo'),
      trip(20, 0, 'Gateway'),
      trip(30, 0),
    ], routes)
    expect(second!.label).toBe('2')
    expect(tenth).toMatchObject({ label: '10', count: 5 })
    expect(tenth!.directions.map(d => [d.label, d.count, d.destinations.map(x => x.label)])).toEqual([
      ['Toward Downtown', 3, ['Downtown', 'Midtown']],
      ['Direction 1', 2, ['Airport', 'Zoo']],
    ])
    expect(tenth!.directions[0]!.destinations[0]!.key).toBe(transferTripKey({ routeId: 10, directionId: 0, headsign: 'Downtown' }))
    // No sign: the route's long name.
    expect(loop!.directions[0]!.label).toBe('Toward Downtown Loop')
  })

  it('numbers both directions where they would read the same', () => {
    const [route] = transferTripChoices([trip(10, 0, 'Loop'), trip(10, 1, 'Loop')], routes)
    expect(route!.directions.map(d => d.label)).toEqual(['Direction 0', 'Direction 1'])
  })
})

describe('transferTripIds', () => {
  it('reads trips from the window to its end plus the longest wait, and early the next day', () => {
    const cache = cacheOf([
      [1, MON, hms(6, 59), 1, 0, 10],
      [1, MON, hms(7), 2, 0, 10],
      [1, MON, hms(8, 21), 3, 0, 10],
      [1, MON, hms(8, 23), 4, 0, 10],
    ])
    const ids = transferTripIds({ stopIds: [1], dates: [MON], startTime: hms(7), endTime: hms(8), stopDepartureCache: cache, maxWalkSeconds: 120 })
    expect(ids.sort()).toEqual([2, 3])
  })
})
