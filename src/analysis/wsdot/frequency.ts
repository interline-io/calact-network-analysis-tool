// Streaming replacement for the departure cache on the WSDOT path.
//
// The service-level rules read two things out of a day's departures and
// nothing else: how many departures a stop has in a given hour, and which
// distinct trips a route runs in a given hour and direction. Both are
// foldable, so departures are counted as they stream past instead of being
// retained. A retained departure costs ~80 bytes and a statewide scenario has
// several million of them, which is what put the report over the Cloudflare
// Worker memory limit; the counters cost a few hundred bytes per stop
// regardless of how much service that stop has.
//
// Only the calendar dates the report actually reads are folded: the weekday,
// the weekend day, and the day after the weekday, whose early hours supply the
// post-midnight half of the night segments. Departures on any other date in
// the scenario range are dropped as they arrive.

import { fmtDate } from '~~/src/core'
import { StopDepartureTuple } from '~~/src/scenario'
import { parseHour, type RouteFrequencyData, type StopFrequencyData } from './service-levels'

const HOURS_PER_DAY = 24
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

// The calendar-date key departures are filed under. `fmtDate` reads a bare
// `yyyy-MM-dd` string as UTC midnight and then renders it in local time, which
// moves the date west of Greenwich; the departures phase emits local dates, so
// an already-keyed string is taken as-is.
function dateKey (date: Date | string): string {
  return typeof date === 'string' && DATE_ONLY.test(date) ? date : fmtDate(date)
}

export interface FrequencyData {
  stops: Map<number, StopFrequencyData>
  routes: Map<number, RouteFrequencyData>
}

/**
 * GTFS ids for the stops and routes a report covers, keyed by numeric id.
 *
 * They are only read for log lines and the matched-route set, so they are
 * resolved once from the accumulated scenario data at build time rather than
 * carried through the fold. Their membership is also the built maps' domain:
 * a departure naming a stop or route the scenario did not fetch is counted but
 * never surfaces, which is what the cache-based path did too.
 */
export interface FrequencyLabels {
  stopGtfsIds: Map<number, string>
  routeGtfsIds: Map<number, string>
}

// A route's departures on one date, in the shape processServiceLevel reads.
interface RouteDateCounts {
  hourlyTrips: Map<number, [Set<number>, Set<number>]>
  stopIds: Set<number>
}

export class WSDOTFrequencyAggregator {
  // Calendar date -> slot in the per-stop counter arrays. Duplicate dates
  // (a weekend date one day after the weekday, say) collapse onto one slot.
  private readonly slots = new Map<string, number>()
  // stopId -> departure counts, indexed slot * 24 + hour.
  private readonly stopHours = new Map<number, Uint32Array>()
  // routeId -> per-slot counts, sparse: a route with no service on a date has
  // no entry for that slot.
  private readonly routeDates = new Map<number, Array<RouteDateCounts | undefined>>()
  // Departures folded per slot, for the "no service on this date" warning.
  private readonly slotCounts: number[]

  constructor (dates: Array<Date | string>) {
    for (const date of dates) {
      const key = dateKey(date)
      if (key && !this.slots.has(key)) {
        this.slots.set(key, this.slots.size)
      }
    }
    this.slotCounts = new Array(this.slots.size).fill(0)
  }

  /** The distinct calendar dates being folded, as `yyyy-MM-dd`. */
  get dates (): string[] {
    return [...this.slots.keys()]
  }

  /** Departures folded for a date. Zero for a date outside the fold. */
  departureCount (date: Date | string): number {
    const slot = this.slots.get(dateKey(date))
    return slot === undefined ? 0 : this.slotCounts[slot]!
  }

  /** Fold one streamed batch. Departures outside the folded dates are dropped. */
  addDepartures (departures: readonly StopDepartureTuple[]): void {
    for (const departure of departures) {
      const slot = this.slots.get(StopDepartureTuple.departureDate(departure))
      if (slot === undefined) {
        continue
      }
      // A feed may leave departure_time blank at a non-timepoint stop; the
      // cache-based path skipped those rather than bucketing -1 seconds.
      const seconds = StopDepartureTuple.departureTime(departure)
      if (seconds < 0) {
        continue
      }
      const hour = parseHour(seconds)
      const stopId = StopDepartureTuple.stopId(departure)
      const routeId = StopDepartureTuple.tripRouteId(departure)
      const direction = StopDepartureTuple.tripDirectionId(departure)

      let hours = this.stopHours.get(stopId)
      if (!hours) {
        hours = new Uint32Array(this.slots.size * HOURS_PER_DAY)
        this.stopHours.set(stopId, hours)
      }
      hours[slot * HOURS_PER_DAY + hour]! += 1

      let dateCounts = this.routeDates.get(routeId)
      if (!dateCounts) {
        dateCounts = new Array(this.slots.size).fill(undefined)
        this.routeDates.set(routeId, dateCounts)
      }
      let counts = dateCounts[slot]
      if (!counts) {
        counts = { hourlyTrips: new Map(), stopIds: new Set() }
        dateCounts[slot] = counts
      }
      // The route rules compare direction_id against 0 and 1 and ignore
      // anything else, so a feed stating some other value must not be folded
      // into a direction. Coercing truthily would file -1 and 2 under
      // direction 1 and let them qualify a route-direction that has no such
      // service. Such a departure still counts at its stop and still marks the
      // route as serving that stop, which is what the cache-based path did.
      if (direction === 0 || direction === 1) {
        let trips = counts.hourlyTrips.get(hour)
        if (!trips) {
          trips = [new Set<number>(), new Set<number>()]
          counts.hourlyTrips.set(hour, trips)
        }
        trips[direction].add(StopDepartureTuple.tripId(departure))
      }
      counts.stopIds.add(stopId)

      this.slotCounts[slot]! += 1
    }
  }

  /**
   * Materialize the maps processServiceLevel reads, for one folded date.
   *
   * Every labelled stop and route gets an entry whether or not it has service,
   * matching the cache-based path: the night-segment pass iterates the stop map
   * and its zero-minimum segments are meant to admit every stop.
   */
  build (date: Date | string, labels: FrequencyLabels): FrequencyData {
    const slot = this.slots.get(dateKey(date))
    const stops = new Map<number, StopFrequencyData>()
    const routes = new Map<number, RouteFrequencyData>()

    for (const [stopId, gtfsStopId] of labels.stopGtfsIds) {
      const hourlyDepartures = new Map<number, number>()
      const hours = slot === undefined ? undefined : this.stopHours.get(stopId)
      if (hours) {
        for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
          const count = hours[slot! * HOURS_PER_DAY + hour]!
          if (count > 0) {
            hourlyDepartures.set(hour, count)
          }
        }
      }
      stops.set(stopId, { stopId, gtfsStopId, hourlyDepartures })
    }

    for (const [routeId, routeGtfsId] of labels.routeGtfsIds) {
      const counts = slot === undefined ? undefined : this.routeDates.get(routeId)?.[slot]
      routes.set(routeId, {
        routeId,
        routeGtfsId,
        hourlyTrips: counts?.hourlyTrips || new Map(),
        stopIds: counts?.stopIds || new Set(),
      })
    }

    return { stops, routes }
  }

  /** Per-hour departure totals across every stop, for the run summary. */
  hourlyTotals (date: Date | string): number[] {
    const totals = new Array(HOURS_PER_DAY).fill(0)
    const slot = this.slots.get(dateKey(date))
    if (slot === undefined) {
      return totals
    }
    for (const hours of this.stopHours.values()) {
      for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
        totals[hour] += hours[slot * HOURS_PER_DAY + hour]!
      }
    }
    return totals
  }
}
