import { describe, it, expect } from 'vitest'
import { parseHour, processServiceLevel, SERVICE_LEVELS, type RouteFrequencyData, type StopFrequencyData } from './service-levels'

// One stop whose departures are given as GTFS seconds, bucketed with the same
// parseHour the aggregator uses, so the fixtures see what production sees.
function stopAt (stopId: number, departureSeconds: number[]): Map<number, StopFrequencyData> {
  const hourlyDepartures = new Map<number, number>()
  for (const secs of departureSeconds) {
    const hour = parseHour(secs)
    hourlyDepartures.set(hour, (hourlyDepartures.get(hour) || 0) + 1)
  }
  return new Map([[stopId, { stopId, gtfsStopId: `s${stopId}`, hourlyDepartures }]])
}

// The peak criteria are also applied route-wide, so a stop only qualifies when
// its route does too. Six trips per hour in each direction clears every level's
// min_tph, keeping these fixtures about the night segments.
function routeServingAllHours (routeId: number, stopId: number): Map<number, RouteFrequencyData> {
  const hourlyTrips = new Map<number, [Set<number>, Set<number>]>()
  let tripId = 0
  for (let hour = 0; hour < 24; hour++) {
    hourlyTrips.set(hour, [
      new Set(Array.from({ length: 6 }, () => ++tripId)),
      new Set(Array.from({ length: 6 }, () => ++tripId)),
    ])
  }
  return new Map([[routeId, {
    routeId,
    routeGtfsId: `r${routeId}`,
    hourlyTrips,
    stopIds: new Set([stopId]),
  }]])
}

describe('processServiceLevel night segments', () => {
  // levelNights requires departures in 23-24, 25-26, 26-27 and 27-28, where
  // hours past 24 resolve against the following calendar day.
  const night = SERVICE_LEVELS.levelNights

  it('counts an overnight trip stated in GTFS 24+ hour time', () => {
    // 23:30 belongs to the analyzed weekday; 25:30, 26:30 and 27:30 are the same
    // service day continuing past midnight, so they are filed on the next date.
    const weekday = stopAt(1, [23.5 * 3600, ...night.peak.hours.map(h => h * 3600)])
    const routes = routeServingAllHours(1, 1)
    const overnight = stopAt(1, [25.5 * 3600, 26.5 * 3600, 27.5 * 3600])
    const qualifying = processServiceLevel(
      night,
      { stops: weekday, routes: routes },
      { stops: weekday, routes: routes },
      { stops: overnight, routes: routes },
    )
    expect(qualifying.has(1)).toBe(true)
  })

  it('counts the same trips stated as early hours of the next day', () => {
    // A feed that codes owl service as 01:30 on the following service day rather
    // than 25:30 on the preceding one must reach the same conclusion.
    const weekday = stopAt(1, [23.5 * 3600, ...night.peak.hours.map(h => h * 3600)])
    const routes = routeServingAllHours(1, 1)
    const overnight = stopAt(1, [1.5 * 3600, 2.5 * 3600, 3.5 * 3600])
    const qualifying = processServiceLevel(
      night,
      { stops: weekday, routes: routes },
      { stops: weekday, routes: routes },
      { stops: overnight, routes: routes },
    )
    expect(qualifying.has(1)).toBe(true)
  })

  it('folds a departure more than 48 hours into its service day', () => {
    // Long-distance trips state stop times well past 24:00:00 — Amtrak's Empire
    // Builder reaches 61:00:00 — so a single subtraction leaves the hour out of
    // range and the departure lands in a bucket nothing reads.
    expect(parseHour(61 * 3600)).toBe(13)
    expect(parseHour(25 * 3600)).toBe(1)
    expect(parseHour(23 * 3600)).toBe(23)
  })

  it('does not count a stop with no overnight service', () => {
    const weekday = stopAt(1, [23.5 * 3600, ...night.peak.hours.map(h => h * 3600)])
    const routes = routeServingAllHours(1, 1)
    const qualifying = processServiceLevel(
      night,
      { stops: weekday, routes: routes },
      { stops: weekday, routes: routes },
      { stops: new Map(), routes: routes },
    )
    expect(qualifying.has(1)).toBe(false)
  })
})
