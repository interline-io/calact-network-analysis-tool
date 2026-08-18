import { describe, it, expect } from 'vitest'
import { WSDOTFrequencyAggregator, type FrequencyLabels } from './frequency'
import { StopDepartureTuple } from '~~/src/scenario'

const WEEKDAY = '2026-08-24'
const WEEKEND = '2026-08-30'
const OVERNIGHT = '2026-08-25'

const labels: FrequencyLabels = {
  stopGtfsIds: new Map([[1, 's1'], [2, 's2']]),
  routeGtfsIds: new Map([[10, 'r10']]),
}

// hours are wall-clock; a GTFS time past 24:00:00 is passed as seconds and
// folds the same way the departures phase files it.
function departure (stopId: number, date: string, seconds: number, tripId: number, direction = 0, routeId = 10) {
  return StopDepartureTuple.create(stopId, date, seconds, tripId, direction, routeId, null)
}

function aggregator () {
  return new WSDOTFrequencyAggregator([WEEKDAY, WEEKEND, OVERNIGHT])
}

describe('WSDOTFrequencyAggregator', () => {
  it('counts departures per stop and hour, per date', () => {
    const agg = aggregator()
    agg.addDepartures([
      departure(1, WEEKDAY, 8 * 3600, 100),
      departure(1, WEEKDAY, 8 * 3600 + 900, 101),
      departure(1, WEEKDAY, 9 * 3600, 102),
      departure(1, WEEKEND, 8 * 3600, 103),
    ])
    const weekday = agg.build(WEEKDAY, labels)
    expect(weekday.stops.get(1)?.hourlyDepartures.get(8)).toBe(2)
    expect(weekday.stops.get(1)?.hourlyDepartures.get(9)).toBe(1)
    const weekend = agg.build(WEEKEND, labels)
    expect(weekend.stops.get(1)?.hourlyDepartures.get(8)).toBe(1)
    expect(weekend.stops.get(1)?.hourlyDepartures.get(9)).toBeUndefined()
  })

  it('keeps distinct trips per route, hour and direction', () => {
    const agg = aggregator()
    agg.addDepartures([
      // The same trip stopping twice in one hour is one trip for the route.
      departure(1, WEEKDAY, 8 * 3600, 100, 0),
      departure(2, WEEKDAY, 8 * 3600 + 300, 100, 0),
      departure(1, WEEKDAY, 8 * 3600 + 600, 101, 1),
    ])
    const trips = agg.build(WEEKDAY, labels).routes.get(10)?.hourlyTrips.get(8)
    expect(trips?.[0]).toEqual(new Set([100]))
    expect(trips?.[1]).toEqual(new Set([101]))
  })

  it('records the stops a route served on each date', () => {
    const agg = aggregator()
    agg.addDepartures([
      departure(1, WEEKDAY, 8 * 3600, 100),
      departure(2, WEEKEND, 8 * 3600, 101),
    ])
    expect(agg.build(WEEKDAY, labels).routes.get(10)?.stopIds).toEqual(new Set([1]))
    expect(agg.build(WEEKEND, labels).routes.get(10)?.stopIds).toEqual(new Set([2]))
  })

  it('drops departures on dates the report does not read', () => {
    const agg = aggregator()
    agg.addDepartures([departure(1, '2026-08-26', 8 * 3600, 100)])
    expect(agg.departureCount('2026-08-26')).toBe(0)
    expect(agg.build('2026-08-26', labels).stops.get(1)?.hourlyDepartures.size).toBe(0)
  })

  it('folds a GTFS time past midnight into the hour of the date it is filed under', () => {
    // The departures phase files a 25:30:00 departure under the next calendar
    // day; parseHour has to reduce it to 01:00 so the night segments, which
    // look up hour 25 as `25 % 24` in that day's map, find it.
    const agg = aggregator()
    agg.addDepartures([departure(1, OVERNIGHT, 25.5 * 3600, 100)])
    expect(agg.build(OVERNIGHT, labels).stops.get(1)?.hourlyDepartures.get(1)).toBe(1)
  })

  it('skips departures with no stated time', () => {
    // parseHMS yields -1 at a non-timepoint stop the feed left blank.
    const agg = aggregator()
    agg.addDepartures([departure(1, WEEKDAY, -1, 100)])
    expect(agg.departureCount(WEEKDAY)).toBe(0)
  })

  it('gives every labelled stop and route an entry, with or without service', () => {
    // The night-segment pass iterates the stop map and its zero-minimum
    // segments are meant to admit every stop, so an unserved stop still needs
    // to be present.
    const agg = aggregator()
    agg.addDepartures([departure(1, WEEKDAY, 8 * 3600, 100)])
    const weekday = agg.build(WEEKDAY, labels)
    expect([...weekday.stops.keys()]).toEqual([1, 2])
    expect(weekday.stops.get(2)?.hourlyDepartures.size).toBe(0)
    expect([...weekday.routes.keys()]).toEqual([10])
    expect(weekday.routes.get(10)?.routeGtfsId).toBe('r10')
  })

  it('ignores stops and routes the scenario did not fetch', () => {
    const agg = aggregator()
    agg.addDepartures([departure(99, WEEKDAY, 8 * 3600, 100, 0, 98)])
    const weekday = agg.build(WEEKDAY, labels)
    expect(weekday.stops.has(99)).toBe(false)
    expect(weekday.routes.has(98)).toBe(false)
  })

  it('collapses a duplicate date onto one slot', () => {
    // weekendDate can land on the day after weekdayDate, which is also the
    // overnight date; a second slot for it would split the counts.
    const agg = new WSDOTFrequencyAggregator([WEEKDAY, OVERNIGHT, OVERNIGHT])
    expect(agg.dates).toEqual([WEEKDAY, OVERNIGHT])
    agg.addDepartures([departure(1, OVERNIGHT, 8 * 3600, 100)])
    expect(agg.departureCount(OVERNIGHT)).toBe(1)
    expect(agg.build(OVERNIGHT, labels).stops.get(1)?.hourlyDepartures.get(8)).toBe(1)
  })

  it('totals departures per hour across stops', () => {
    const agg = aggregator()
    agg.addDepartures([
      departure(1, WEEKDAY, 8 * 3600, 100),
      departure(2, WEEKDAY, 8 * 3600, 101),
      departure(1, WEEKDAY, 17 * 3600, 102),
    ])
    const totals = agg.hourlyTotals(WEEKDAY)
    expect(totals[8]).toBe(2)
    expect(totals[17]).toBe(1)
    expect(agg.departureCount(WEEKDAY)).toBe(3)
  })
})
