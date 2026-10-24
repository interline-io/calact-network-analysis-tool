import { describe, it, expect } from 'vitest'
import { StopDepartureCache } from '../../tl/departure-cache'
import { isoToOrdinal, ordinalToIso } from '../../tl/feed-version'
import type { TripDetail, TripStopTime } from '../../tl/trip-details'
import type { TripTableStop } from './subject-trips'
import {
  bearingAndDistance,
  calculateTransfers,
  calendarTime,
  decodeTransferSettings,
  encodeTransferSettings,
  focusFilters,
  formatWait,
  summarizeTransfers,
  transferEvents,
  transferGrade,
  transferGrid,
  transferOverview,
  transferRows,
  transferSummaryGrid,
  transferSummaryRows,
  transferTripChoices,
  transferTripInfo,
  transferTripKey,
  transferTripTags,
  DEFAULT_TRANSFER_SETTINGS,
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
  return isoToOrdinal(date) * 86400 + time
}

function event (tripId: number, routeId: number, time: number, stopId = 1, directionId = 0): TransferEvent {
  return { tripId, routeId, directionId, stopId, serviceDate: MON, time: at(time), ...calendarTime(at(time)) }
}

const breakpoints = [-300, 0, 360, 600, 1200]
const walk = { walkSeconds: (a: number, b: number) => (a === b ? 0 : 120), maxWalkSeconds: 120, breakpoints }
// The reach transferEvents reads departures over.
const reach = { maxWalkSeconds: 120, breakpoints }

describe('dates and times', () => {
  it('round-trips day numbers and reads an absolute time\'s calendar date', () => {
    expect(ordinalToIso(isoToOrdinal(MON) + 1)).toBe(TUE)
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
    expect(transferGrade(0)).toBe('close')
    expect(transferGrade(hms(0, 6))).toBe('acceptable')
    expect(transferGrade(hms(0, 10))).toBe('unacceptable')
    expect(transferGrade(hms(0, 20))).toBe('unacceptable')
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
    const events = transferEvents({ stopIds: [1, 2], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    expect(events.arrivals.map(e => [e.tripId, calendarTime(e.time).seconds])).toEqual([
      [100, hms(6, 59)],
      [300, hms(7, 10)],
      [400, hms(7, 15)],
    ])
    expect(events.departures.map(e => e.tripId)).toEqual([100, 200])
    expect(events.missingTripIds).toEqual([])
    // Trip 300 ends at the stops, and trip 200 starts there.
    expect(events.arrivals.map(e => e.terminal)).toEqual([false, true, false])
    expect(events.departures.map(e => e.terminal)).toEqual([false, true])
  })

  it('neither arrives nor departs a trip starting at one of the stops and ending at another', () => {
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [2, MON, hms(7, 2), 100, 0, 10],
      // Trip 200 starts at stop 1 and goes on past stop 2: it departs,
      // boarded at either, starting here, and does not arrive.
      [1, MON, hms(7), 200, 0, 20],
      [2, MON, hms(7, 2), 200, 0, 20],
    ])
    const tripDetails = new Map([
      [100, detail(100, [{ stopId: 1, departure: hms(7) }, { stopId: 2, arrival: hms(7, 2) }])],
      [200, detail(200, [{ stopId: 1, departure: hms(7) }, { stopId: 2, arrival: hms(7, 2), departure: hms(7, 2) }, { stopId: 8, arrival: hms(7, 9) }])],
    ])
    const events = transferEvents({ stopIds: [1, 2], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    expect(events.arrivals).toEqual([])
    expect(events.departures.map(e => [e.tripId, e.calls?.map(c => c.stopId), e.terminal])).toEqual([[200, [1, 2], true]])
  })

  it('counts a trip at several of the stops in a row once, with each call a rider could use', () => {
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [2, MON, hms(7, 2), 100, 0, 10],
    ])
    const tripDetails = new Map([
      [100, detail(100, [{ stopId: 9, departure: hms(6, 50) }, { stopId: 1, arrival: hms(7), departure: hms(7) }, { stopId: 2, arrival: hms(7, 2), departure: hms(7, 2) }, { stopId: 8, arrival: hms(7, 9) }])],
    ])
    const events = transferEvents({ stopIds: [1, 2], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    const calls = (e: TransferEvent) => e.calls?.map(c => [c.stopId, calendarTime(c.time).seconds])
    expect(events.arrivals.map(calls)).toEqual([[[1, hms(7)], [2, hms(7, 2)]]])
    expect(events.departures.map(calls)).toEqual([[[1, hms(7)], [2, hms(7, 2)]]])
  })

  it('counts each visit of a trip that leaves the stops and comes back', () => {
    // Loop trip 100: 9, 1 at 08:10, 8, 1 at 08:30, 7.
    const cache = cacheOf([
      [1, MON, hms(8, 10), 100, 0, 10],
      [1, MON, hms(8, 30), 100, 0, 10],
    ])
    const tripDetails = new Map([
      [100, detail(100, [
        { stopId: 9, departure: hms(8) },
        { stopId: 1, arrival: hms(8, 10), departure: hms(8, 10) },
        { stopId: 8, arrival: hms(8, 20), departure: hms(8, 20) },
        { stopId: 1, arrival: hms(8, 30), departure: hms(8, 30) },
        { stopId: 7, arrival: hms(8, 40) },
      ])],
    ])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    expect(events.arrivals.map(e => [calendarTime(e.time).seconds, e.prevStation, e.nextStation])).toEqual([[hms(8, 10), 9, 8], [hms(8, 30), 8, 7]])
    expect(events.departures.map(e => calendarTime(e.time).seconds)).toEqual([hms(8, 10), hms(8, 30)])
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
    // Each from stop 9 through stop 1; trip 200 then goes elsewhere, so is a
    // change, not the same way.
    const through = (id: number, t: number, next = 8) => detail(id, [{ stopId: 9, departure: t - 600 }, { stopId: 1, arrival: t, departure: t }, { stopId: next, arrival: t + 600 }])
    const tripDetails = new Map([[100, through(100, hms(23, 55))], [200, through(200, hms(24, 5), 7)], [300, through(300, hms(8))]])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: hms(20), endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    expect(events.arrivals.map(e => e.tripId)).toEqual([100])
    const [group] = calculateTransfers(events.arrivals, events.departures, walk)
    expect(group!.connections.map(c => [c.departure.tripId, c.wait])).toEqual([[200, 600]])
    expect(events.departures.find(e => e.tripId === 200)?.serviceDate).toBe(MON)
    expect(events.arrivals.map(e => [e.prevStation, e.nextStation])).toEqual([[9, 8]])
  })

  it('leaves out trips whose details have not arrived', () => {
    const cache = cacheOf([[1, MON, hms(7), 100, 0, 10]])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails: new Map(), ...reach })
    expect(events.arrivals).toEqual([])
    expect(events.missingTripIds).toEqual([100])
  })
})

describe('calculateTransfers', () => {
  it('boards a trip at several of the stops at the call that serves the rider best', () => {
    // Stops 1 and 2 are 300 s apart. Trip 2 leaves stop 1 at 08:02 and stop 2
    // at 08:04; arriving at stop 1 at 08:00, a rider boards at stop 1.
    const walkAB = { ...walk, walkSeconds: (a: number, b: number) => (a === b ? 0 : 300), maxWalkSeconds: 300 }
    const departure = { ...event(2, 20, hms(8, 2), 1), calls: [{ stopId: 1, time: at(hms(8, 2)) }, { stopId: 2, time: at(hms(8, 4)) }] }
    const [group] = calculateTransfers([event(1, 10, hms(8), 1)], [departure], walkAB)
    expect(group!.connections.map(c => [c.departure.stopId, c.wait, c.grade])).toEqual([[1, 120, 'close']])
    // Arriving at stop 2 at 08:00, and on to stop 1 at 08:03, a rider for a
    // 08:04 departure at stop 1 stays on rather than walk and miss it.
    const arrival = { ...event(1, 10, hms(8), 2), calls: [{ stopId: 2, time: at(hms(8)) }, { stopId: 1, time: at(hms(8, 3)) }] }
    const [stayOn] = calculateTransfers([arrival], [{ ...event(2, 20, hms(8, 4), 1) }], walkAB)
    expect(stayOn!.connections.map(c => [c.alight?.stopId, c.departure.stopId, c.walk, c.wait])).toEqual([[1, 1, 0, 60]])
    // Arriving at stop 1 at 08:00 and on to stop 2 at 08:06, a rider for an
    // 08:10 departure at stop 1 waits there, not riding on to walk back.
    const ridePast = { ...event(1, 10, hms(8), 1), calls: [{ stopId: 1, time: at(hms(8)) }, { stopId: 2, time: at(hms(8, 6)) }] }
    const [waits] = calculateTransfers([ridePast], [{ ...event(2, 20, hms(8, 10), 1) }], { ...walkAB, walkSeconds: (a: number, b: number) => (a === b ? 0 : 60) })
    expect(waits!.connections.map(c => [c.alight?.stopId, c.walk, c.wait])).toEqual([[undefined, 0, 600]])
    // The CSV leaves the arriving trip where the rider does.
    const stops = new Map([[1, { stop_id: 'A', stop_name: 'A' }], [2, { stop_id: 'B', stop_name: 'B' }]]) as unknown as Map<number, TripTableStop>
    const [row] = transferRows([stayOn!], { routes: new Map(), stops, tripDetails: new Map() })
    expect([row!.from_stop_id, row!.arrival_time, row!.to_stop_id]).toEqual(['A', '08:03:00', 'A'])
  })

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
      [4, 120, hms(0, 3), 'close'],
      [7, 0, hms(0, 4), 'close'],
    ])
  })

  it('leaves out trips back the way an arrival came or on its way, unless counted', () => {
    // The arrival came from station 100 and goes on to 200. Route 11 goes
    // next to 100 (back), 12 to 200 (the same way), 13 to 300.
    const arrival = { ...event(1, 10, hms(7)), prevStation: 100, nextStation: 200 }
    const back = { ...event(2, 11, hms(7, 5)), prevStation: 200, nextStation: 100 }
    const same = { ...event(3, 12, hms(7, 6)), prevStation: 100, nextStation: 200 }
    const other = { ...event(4, 13, hms(7, 7)), nextStation: 300 }
    const [group] = calculateTransfers([arrival], [back, same, other], walk)
    expect(group!.connections.map(c => c.departure.tripId)).toEqual([4])
    const [counted] = calculateTransfers([arrival], [back, same, other], { ...walk, countSameWay: true })
    expect(counted!.connections.map(c => [c.departure.tripId, c.way])).toEqual([[2, 'back'], [3, 'same'], [4, undefined]])
  })

  it('takes a trip ending here back the way it came as no transfer', () => {
    // A line ending here, and the other direction leaving from another
    // platform of the station: back the way it came.
    const arrival = { ...event(1, 10, hms(7)), terminal: true, prevStation: 100 }
    const reverse = { ...event(2, 11, hms(7, 5), 2), terminal: true, nextStation: 100 }
    expect(calculateTransfers([arrival], [reverse], walk)[0]!.connections).toEqual([])
  })

  it('takes the earliest departure a rider can make on a destination, not the shortest wait', () => {
    // Stop 2 is 2 minutes' walk away; stop 1 is where the arrival is.
    const far = event(2, 20, hms(7, 3), 2)
    const near = event(3, 20, hms(7, 2))
    const [group] = calculateTransfers([event(1, 10, hms(7))], [near, far], walk)
    // The nearer departure leaves first (a 2 minute wait), though the far
    // one waits only 1 minute after the walk.
    expect(group!.connections.map(c => [c.departure.tripId, c.wait])).toEqual([[3, hms(0, 2)]])
  })

  it('counts a short run apart from the full one on its route and direction', () => {
    const full = { ...event(2, 20, hms(7, 8)), headsign: 'Airport' }
    const short = { ...event(3, 20, hms(7, 4)), headsign: 'Downtown' }
    const later = { ...event(4, 20, hms(7, 12)), headsign: 'Downtown' }
    const [group] = calculateTransfers([event(1, 10, hms(7))], [short, full, later], walk)
    expect(group!.connections.map(c => c.departure.tripId)).toEqual([3, 2])
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
      [3, 'close'],
      [5, 'acceptable'],
    ])
    const [all] = calculateTransfers([event(1, 10, hms(7))], deps, { ...walk, allConnections: true })
    expect(all!.connections.map(c => c.departure.tripId)).toEqual([2, 3, 5, 4])
  })

  it('leaves out stops whose walk between them is not known', () => {
    const [group] = calculateTransfers([event(1, 10, hms(7))], [event(2, 20, hms(7, 5), 2), event(3, 30, hms(7, 6))], {
      walkSeconds: (a, b) => (a === b ? 0 : Number.NaN),
      maxWalkSeconds: 0,
      breakpoints,
    })
    expect(group!.connections.map(c => c.departure.tripId)).toEqual([3])
  })

  it('sums up each arrival by its earliest departure made, not its shortest wait', () => {
    // At the same stop at 07:04 (a 4 minute wait), and 2 minutes' walk away
    // at 07:05 (a 3 minute wait).
    const [group] = calculateTransfers([event(1, 10, hms(7))], [event(2, 20, hms(7, 4)), event(3, 30, hms(7, 5), 2)], walk)
    expect(transferOverview([group!]).medianWait).toBe(hms(0, 4))
  })

  it('counts a connection made only once it is better than missed, whatever the breakpoints', () => {
    // Close from 1 minute: a 30 s wait is missed, so the later close one shows.
    const deps = [event(2, 20, hms(7) + 30), event(3, 20, hms(7, 3))]
    const [group] = calculateTransfers([event(1, 10, hms(7))], deps, { ...walk, breakpoints: [-300, 60, 360, 600, 1200] })
    expect(group!.connections.map(c => [c.departure.tripId, c.grade])).toEqual([[2, 'missed'], [3, 'close']])
    expect(transferOverview([group!]).medianWait).toBe(hms(0, 3))
  })

  it('takes other breakpoints', () => {
    const [group] = calculateTransfers([event(1, 10, hms(7))], [event(2, 20, hms(7, 25))], { ...walk, breakpoints: [-600, 0, 600, 1200, 1800] })
    expect(group!.connections.map(c => c.grade)).toEqual(['unacceptable'])
  })
})

describe('summarizeTransfers and transferOverview', () => {
  const arrivals = [event(1, 10, hms(7)), event(2, 10, hms(7, 30)), event(3, 10, hms(8))]
  const departures = [
    // Close after the first arrival, unacceptable after the second, none after
    // the third.
    event(11, 20, hms(7, 3)),
    event(12, 20, hms(7, 45)),
  ]
  const groups = calculateTransfers(arrivals, departures, walk)

  it('totals connections by destination pair against every arrival on the arriving destination', () => {
    const [from] = summarizeTransfers(groups)
    expect(from!.from).toMatchObject({ routeId: 10 })
    expect(from!.overview.arrivals).toBe(3)
    const [row] = from!.pairs
    expect(row).toMatchObject({ to: { routeId: 20 }, close: 1, unacceptable: 1, missed: 0, acceptable: 0 })
    expect(row!.closeOrAcceptableShare).toBeCloseTo(1 / 3)
    expect(row!.closeShare).toBeCloseTo(1 / 3)
    expect(row!.acceptableShare).toBe(0)
    expect(row!.medianWait).toBe((hms(0, 3) + hms(0, 15)) / 2)
  })

  it('nests each arriving destination\'s figures over the departing ones it connects to', () => {
    const empty = { routes: new Map(), from: new Map(), to: new Map() }
    const rows = transferSummaryGrid(summarizeTransfers(groups), empty)
    expect(rows.map(r => [r.head, r.group === rows[0]!.id, r.arrivals, r.close, r.unacceptable])).toEqual([
      [true, true, 3, 1, 1],
      [false, true, '', 1, 1],
    ])
    const individual = transferGrid(groups, { ...empty, stops: new Map() })
    expect(individual.map(r => [r.head, r.time, r.grade])).toEqual([
      [true, '07:00:00', ''],
      [false, '07:03:00', 'close'],
      [true, '07:30:00', ''],
      [false, '07:45:00', 'unacceptable'],
      [true, '08:00:00', 'none'],
    ])
  })

  it('writes a summary row for an arriving destination with no connections', () => {
    const lone = calculateTransfers([event(1, 30, hms(9))], departures, walk)
    const rows = transferSummaryRows(summarizeTransfers(lone), new Map())
    expect(rows.map(r => [r.arrivals, r.to_direction_id, r.close, r.median_wait_seconds])).toEqual([[1, '', 0, '']])
  })

  it('tags a pair by the way its connections go, or both where they differ', () => {
    // Arriving from station 5 toward station 6.
    const arrival = { ...event(1, 10, hms(7)), prevStation: 5, nextStation: 6 }
    const on = (tripId: number, at: number, next: number) => ({ ...event(tripId, 20, at), nextStation: next })
    const tag = (deps: TransferEvent[]) => {
      const rows = transferSummaryGrid(summarizeTransfers(calculateTransfers([arrival], deps, { ...walk, countSameWay: true, allConnections: true })), { routes: new Map(), from: new Map(), to: new Map() })
      return rows[1]!.tags.filter(t => t.kind === 'back' || t.kind === 'same').map(t => [t.kind, t.label])
    }
    expect(tag([on(2, hms(7, 2), 6), on(3, hms(7, 4), 6)])).toEqual([['same', 'Same way']])
    expect(tag([on(2, hms(7, 2), 5), on(3, hms(7, 4), 6)])).toEqual([['back', 'Back or same way']])
  })

  it('sums up every arrival by its soonest connection', () => {
    expect(transferOverview(groups)).toMatchObject({ arrivals: 3, connections: 2, closeOrAcceptableShare: 1 / 3, medianWait: (hms(0, 3) + hms(0, 15)) / 2 })
  })

  it('counts connections by grade', () => {
    expect(transferOverview(groups).grades.map(c => [c.grade, c.count])).toEqual([['missed', 0], ['close', 1], ['acceptable', 0], ['unacceptable', 1]])
  })

  it('writes a row per connection, and one for an arrival with none', () => {
    const rows = transferRows(groups, { routes: new Map(), stops: new Map(), tripDetails: new Map() })
    expect(rows.map(r => [r.arrival_time, r.departure_time, r.grade, r.grade_label])).toEqual([
      ['07:00:00', '07:03:00', 'close', 'Close'],
      ['07:30:00', '07:45:00', 'unacceptable', 'Unacceptable'],
      ['08:00:00', '', 'none', 'No connection'],
    ])
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
      // Neither has half; the two together do.
      ['Toward Airport or Zoo', 2, ['Airport', 'Zoo']],
    ])
    expect(tenth!.directions[0]!.destinations[0]!.key).toBe(transferTripKey({ routeId: 10, directionId: 0, headsign: 'Downtown' }))
    // No sign: the route's long name.
    expect(loop!.directions[0]!.label).toBe('Toward Downtown Loop')
  })

  it('names a direction by where its trips end where their signs do not tell the directions apart', () => {
    const ending = (directionId: number, terminus: string) => ({ ...trip(10, directionId, 'Loop'), terminus })
    const [route] = transferTripChoices([ending(0, 'North TC'), ending(0, 'North TC'), ending(1, 'South TC')], routes)
    expect(route!.directions.map(d => d.label)).toEqual(['Toward North TC', 'Toward South TC'])
  })

  it('marks a destination making fewer stops than its direction\'s main one as a short run', () => {
    const run = (headsign: string, origin: string, terminus: string, stopCount: number, terminal = false) => ({ ...trip(10, 0, headsign), origin, terminus, stopCount, terminal })
    const [route] = transferTripChoices([
      run('Downtown', 'Gateway', 'Downtown', 30), run('Downtown', 'Gateway', 'Downtown', 30),
      run('Midtown', 'Gateway', 'Midtown', 12, true),
    ], routes)
    const [downtown, midtown] = route!.directions[0]!.destinations
    expect(downtown!.shortOf).toBeUndefined()
    expect(midtown!.shortOf).toEqual({ origin: 'Gateway', terminus: 'Downtown', stopCount: 30 })
    expect(transferTripTags(midtown, 'from').map(t => t.label)).toEqual(['Ends here', 'Short run'])
    expect(transferTripTags(midtown, 'to', false).map(t => t.label)).toEqual(['Short run'])
    expect(transferTripInfo([route!]).get(midtown!.key)?.routeId).toBe(10)
  })

  it('names arriving trips that end at the stops by where they come from', () => {
    const ending = (directionId: number, origin: string) => ({ ...trip(10, directionId, 'Millbrae'), origin, terminal: true })
    const [route] = transferTripChoices([ending(0, 'Richmond'), ending(0, 'Richmond'), ending(1, 'SFO')], routes, 'from')
    expect(route!.directions.map(d => [d.label, d.destinations.map(x => x.label)])).toEqual([
      ['From Richmond', ['From Richmond']],
      ['From SFO', ['From SFO']],
    ])
  })

  it('names departing trips signed for where they start by where they end', () => {
    // Signed with the stop's own name, under a station named otherwise.
    const starting = { ...trip(10, 0, 'San Jose'), origin: 'San Jose Diridon', originNames: ['San Jose', 'San Jose Diridon'], terminus: 'Sacramento' }
    const [route] = transferTripChoices([starting], routes, 'to')
    expect(route!.directions[0]!.destinations.map(x => [x.label, x.sign])).toEqual([['Sacramento', 'San Jose']])
  })

  it('names destinations signed the same both ways by where they end', () => {
    const ending = (directionId: number, terminus: string) => ({ ...trip(10, directionId, 'SFO / SF / Antioch'), terminus })
    const [route] = transferTripChoices([ending(0, 'Antioch'), ending(1, 'SFO')], routes)
    expect(route!.directions.flatMap(d => d.destinations.map(x => x.label))).toEqual([
      'Antioch',
      'SFO',
    ])
    expect(route!.directions.flatMap(d => d.destinations.map(x => x.sign))).toEqual(['SFO / SF / Antioch', 'SFO / SF / Antioch'])
  })

  it('names each route\'s operator', () => {
    const withAgency = new Map([[10, { route_id: 'R10', route_short_name: '10', agency: { agency_name: 'Caltrain' } }]])
    const [route] = transferTripChoices([trip(10, 0, 'San Francisco')], withAgency)
    expect(route!.operator).toBe('Caltrain')
  })

  it('numbers both directions where they would read the same', () => {
    const [route] = transferTripChoices([trip(10, 0, 'Loop'), trip(10, 1, 'Loop')], routes)
    expect(route!.directions.map(d => d.label)).toEqual(['Direction 0', 'Direction 1'])
  })
})

describe('transferEvents reach', () => {
  it('needs the trips from a missed connection before the window to its end plus the longest walk and wait, or a long dwell', () => {
    // The walk and wait reach 22 minutes past the window; a trip arriving in
    // it may wait an hour before it leaves, so trips leaving by 9:00 count.
    const cache = cacheOf([
      [1, MON, hms(6, 54), 1, 0, 10],
      [1, MON, hms(6, 56), 2, 0, 10],
      [1, MON, hms(8, 59), 3, 0, 10],
      [1, MON, hms(9, 1), 4, 0, 10],
    ])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: hms(7), endTime: hms(8), stopDepartureCache: cache, tripDetails: new Map(), ...reach })
    expect(events.missingTripIds.sort()).toEqual([2, 3])
  })

  it('reads the night before a date for departures an arrival just after midnight misses', () => {
    const cache = cacheOf([
      // Sunday 23:58, two minutes before Monday's window opens.
      [1, '2026-10-18', hms(23, 58), 1, 0, 10],
      // Sunday's own evening trip, not within reach.
      [1, '2026-10-18', hms(20), 2, 0, 10],
    ])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: 0, endTime: hms(1), stopDepartureCache: cache, tripDetails: new Map(), ...reach })
    expect(events.missingTripIds).toEqual([1])
  })

  it('reads the day after a date only for departures past midnight', () => {
    const cache = cacheOf([
      // Tuesday's own morning trip is not Monday's spillover.
      [1, TUE, hms(7, 30), 1, 0, 10],
      // Monday's trip past midnight, filed under Tuesday.
      [1, TUE, hms(24, 5), 2, 0, 10],
    ])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: hms(20), endTime: hms(24), stopDepartureCache: cache, tripDetails: new Map(), ...reach })
    expect(events.missingTripIds).toEqual([2])
  })
})

describe('transferEvents for a trip from frequencies.txt', () => {
  it('keeps each run of the trip apart', () => {
    // One trip id run every 30 minutes; its stated time at stop 1 is 07:00.
    const cache = cacheOf([
      [1, MON, hms(7), 100, 0, 10],
      [1, MON, hms(7, 30), 100, 0, 10],
      [1, MON, hms(8), 100, 0, 10],
    ])
    const tripDetails = new Map([[100, detail(100, [{ stopId: 9, departure: hms(6, 50) }, { stopId: 1, arrival: hms(7), departure: hms(7) }, { stopId: 8, arrival: hms(7, 10) }])]])
    const events = transferEvents({ stopIds: [1], dates: [MON], startTime: 0, endTime: hms(24), stopDepartureCache: cache, tripDetails, ...reach })
    expect(events.arrivals.map(e => e.seconds)).toEqual([hms(7), hms(7, 30), hms(8)])
    expect(events.departures.map(e => e.seconds)).toEqual([hms(7), hms(7, 30), hms(8)])
  })
})

describe('focusFilters', () => {
  const a = { ...event(1, 10, hms(8)), headsign: 'North' }
  const b = { ...event(2, 11, hms(8)), headsign: 'South' }
  const c = { ...event(5, 12, hms(8)), headsign: 'West' }
  const x = { ...event(3, 20, hms(8, 5)), headsign: 'East' }
  const y = { ...event(4, 21, hms(8, 5)), headsign: 'West' }
  const choices = { from: transferTripChoices([a, b, c], new Map()), to: transferTripChoices([x, y], new Map()) }
  const none = { excludedFrom: [], excludedTo: [] }

  it('leaves out every arriving destination outside the focus', () => {
    expect(focusFilters({ from: [transferTripKey(a)] }, choices, none))
      .toEqual({ excludedFrom: [transferTripKey(b), transferTripKey(c)], excludedTo: [] })
  })

  it('narrows departing ones where named, within the filters already set', () => {
    const current = { excludedFrom: [transferTripKey(c)], excludedTo: [] }
    expect(focusFilters({ from: [transferTripKey(a), transferTripKey(c)], to: [transferTripKey(y)] }, choices, current))
      .toEqual({ excludedFrom: [transferTripKey(c), transferTripKey(b)], excludedTo: [transferTripKey(x)] })
  })
})

describe('encodeTransferSettings', () => {
  it('holds only what differs from the defaults, and reads back', () => {
    expect(encodeTransferSettings(DEFAULT_TRANSFER_SETTINGS)).toBeUndefined()
    const changed = { ...DEFAULT_TRANSFER_SETTINGS, walkDistance: 'street' as const, excludedTo: ['1|0|North'] }
    const json = encodeTransferSettings(changed)!
    expect(JSON.parse(json)).toEqual({ walkDistance: 'street', excludedTo: ['1|0|North'] })
    expect(decodeTransferSettings(json)).toEqual(changed)
  })

  it('leaves what it cannot read at the defaults', () => {
    expect(decodeTransferSettings('not json')).toEqual(DEFAULT_TRANSFER_SETTINGS)
    expect(decodeTransferSettings('null')).toEqual(DEFAULT_TRANSFER_SETTINGS)
    expect(decodeTransferSettings('[1]')).toEqual(DEFAULT_TRANSFER_SETTINGS)
    expect(decodeTransferSettings(JSON.stringify({ walkDistance: 'teleport', breakpoints: [3, 2, 1], secondsPerMeter: 1.5 })))
      .toEqual({ ...DEFAULT_TRANSFER_SETTINGS, secondsPerMeter: 1.5 })
  })
})

describe('bearingAndDistance', () => {
  it('measures bearing clockwise from north, and distance in km', () => {
    const millbrae: [number, number] = [-122.387, 37.600]
    const north = bearingAndDistance(millbrae, [-122.395, 37.776])
    expect(north.bearing > 355 || north.bearing < 5).toBe(true)
    expect(north.km).toBeGreaterThan(18)
    expect(north.km).toBeLessThan(21)
    const southeast = bearingAndDistance(millbrae, [-121.903, 37.330])
    expect(southeast.bearing).toBeGreaterThan(120)
    expect(southeast.bearing).toBeLessThan(150)
  })
})
