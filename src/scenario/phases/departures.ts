// Phase 4: fetch departures for the scenario's routes, entering via
// route -> trips -> stop_times. This is by far the most expensive phase;
// taking explicit route and stop ids means a client can shard one scenario's
// departures across several standalone requests, each safely under proxy/CDN
// time limits.
//
// Departures are reported on calendar days, not GTFS service days: a trip
// departing after midnight belongs to the day it actually departs on, at its
// wall-clock time.

import { format } from 'date-fns'
import { chunkArray, parseHMS, TaskQueue, type GraphQLClient } from '~~/src/core'
import { routeTripsQuery, type RouteTripFrequency, type RouteTripsResponse } from '~~/src/tl'
import { getSelectedDateRange, PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type PhaseEmit, type PhaseOpts } from './common'
import type { ScenarioProgress } from '../scenario'

// Routes per GraphQL request. Deliberately 1: it keeps each request's scope
// (and cost) predictable at one route-week, and larger batches have returned
// silently incomplete data.
const TRIP_ROUTE_BATCH_SIZE = 1

// Tuples per emitted progress event; one route batch can expand to hundreds of
// thousands of departures.
const TRIP_DEPARTURE_EMIT_SIZE = 50_000

const SECONDS_PER_DAY = 86400

// Optimized wire format: departure_time as seconds, no string trip_id.
export type StopDepartureTuple = readonly [
  stop_id: number,
  departure_date: string, // calendar date the departure falls on
  // Seconds since midnight of the departure's own GTFS service day, so a trip
  // running past midnight reads 24:00:00 or later on the date it departs.
  departure_time: number,
  trip_id: number,
  trip_direction_id: number,
  trip_route_id: number,
  pickup_type: number | null // GTFS pickup_type; null when the feed omits it
]

// Helper functions for working with the tuple
export const StopDepartureTuple = {
  create: (
    stop_id: number,
    departure_date: string,
    departure_time: number,
    trip_id: number,
    trip_direction_id: number,
    trip_route_id: number,
    pickup_type: number | null,
  ): StopDepartureTuple => [stop_id, departure_date, departure_time, trip_id, trip_direction_id, trip_route_id, pickup_type],
  stopId: (tuple: StopDepartureTuple) => tuple[0],
  departureDate: (tuple: StopDepartureTuple) => tuple[1],
  departureTime: (tuple: StopDepartureTuple) => tuple[2],
  tripId: (tuple: StopDepartureTuple) => tuple[3],
  tripDirectionId: (tuple: StopDepartureTuple) => tuple[4],
  tripRouteId: (tuple: StopDepartureTuple) => tuple[5],
  pickupType: (tuple: StopDepartureTuple) => tuple[6],
}

export interface DeparturesPhaseConfig {
  // Stops to keep departures for; routes reach beyond the scenario area.
  stopIds: number[]
  // Routes to fetch. Nothing is fetched without them.
  routeIds?: number[]
  startDate?: Date
  endDate?: Date
  // Routes per GraphQL request; default 1. Raising it is not recommended —
  // see TRIP_ROUTE_BATCH_SIZE.
  routeBatchSize?: number
  // Route id -> the stops in this scenario that route serves, as produced by
  // the stops phase. Omitting it falls back to filtering by the whole stop set.
  routeStopIds?: Record<number, number[]>
}

interface TripFetchTask {
  routeIds: number[]
  // One week of requested calendar dates, as `yyyy-MM-dd`.
  dates: string[]
  // Stop times are filtered to these; never empty.
  stopIds: number[]
}

// Which calendar date a GTFS departure falls on. GTFS counts seconds from the
// service day's midnight and runs past 24:00:00 for after-midnight trips, so
// `25:00:00` on a Monday belongs to the Tuesday.
//
// The seconds are returned as the feed states them rather than reduced into the
// day, which is what the stop-oriented path produced and what the consumers of
// this cache still expect: they treat 86400 as the end of a day, so a departure
// at 25:00:00 sits outside a 00:00:00-24:00:00 window rather than at 01:00:00
// inside it.
function calendarDeparture (serviceDate: string, seconds: number): { date: string, seconds: number } {
  const days = Math.floor(seconds / SECONDS_PER_DAY)
  if (days === 0) {
    return { date: serviceDate, seconds }
  }
  const d = new Date(`${serviceDate}T00:00:00`)
  d.setDate(d.getDate() + days)
  return { date: format(d, 'yyyy-MM-dd'), seconds }
}

// A trip's first departure, which generated departures are measured from.
// Reached through the frequency's trip so it survives the stop_ids filter on
// the trip's own stop times.
function frequencyAnchor (frequencies: RouteTripFrequency[]): number | null {
  for (const f of frequencies) {
    const st = f.trip?.stop_times?.[0]
    if (st?.departure_time) {
      return parseHMS(st.departure_time)
    }
  }
  return null
}

// When one stop time of a frequency-based trip departs, in GTFS seconds from
// the service day's midnight.
//
// Such a trip's stop times state travel times rather than real departures: the
// trip repeats every headway_secs from start_time, and each repetition reaches
// a stop at that stop's offset from the trip's first departure. end_time counts
// when a headway lands exactly on it. Returns nothing without an anchor, since
// the offsets cannot be placed.
export function frequencyDepartures (frequencies: RouteTripFrequency[], stopTimeSeconds: number): number[] {
  const anchor = frequencyAnchor(frequencies)
  if (anchor === null) {
    return []
  }
  const offset = stopTimeSeconds - anchor
  const departures: number[] = []
  for (const f of frequencies) {
    if (f.headway_secs <= 0) {
      continue
    }
    const end = parseHMS(f.end_time)
    for (let t = parseHMS(f.start_time); t <= end; t += f.headway_secs) {
      departures.push(t + offset)
    }
  }
  return departures
}

// Departures via route -> trips -> stop_times instead of per (stop, date).
// Trips carry their service dates once; this expands them back into a flat
// StopDepartureTuple stream keyed by calendar date.
export async function runDeparturesPhase (
  config: DeparturesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const routeIds = config.routeIds || []
  const selectedDates = getSelectedDateRange(config)
  const batchSize = config.routeBatchSize ?? TRIP_ROUTE_BATCH_SIZE

  const queue: TaskQueue<TripFetchTask> = new TaskQueue<TripFetchTask>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    task => fetchRouteTrips(task),
    {
      onProgress: () => { emit(progressEvent()) },
      onError: error => opts.onError?.(error),
    },
  )

  function progressEvent (): ScenarioProgress {
    const p = queue.getProgress()
    return {
      isLoading: true,
      currentStage: 'schedules',
      stopDepartureProgress: p,
      phaseProgress: { phase: 'departures', completed: p.completed, total: p.total },
    }
  }

  async function fetchRouteTrips (task: TripFetchTask): Promise<void> {
    const { routeIds: chunk, dates, stopIds } = task
    const requested = new Set(dates)
    const response = await client.query<{ routes: RouteTripsResponse[] }>(routeTripsQuery, {
      ids: chunk,
      dates,
      stopIds,
      limit: chunk.length,
    })
    const stopDepartures: StopDepartureTuple[] = []
    const tripIdStrings = new Map<number, string>()
    for (const route of response.data?.routes || []) {
      for (const trip of route.trips || []) {
        if (trip.trip_id) {
          tripIdStrings.set(trip.id, trip.trip_id)
        }
        // The fan-out the backend no longer does: one tuple per stop time per
        // date the trip runs.
        const frequencies = trip.frequencies || []
        for (const st of trip.stop_times || []) {
          const stopTimeSeconds = parseHMS(st.departure_time)
          // A feed may leave departure_time blank at a non-timepoint stop. The
          // stop-oriented path dropped those server-side; keeping them would
          // resolve -1 seconds onto the previous day at 23:59:59.
          if (stopTimeSeconds < 0) {
            continue
          }
          // A frequency-based trip's generated departures replace its stop
          // times rather than adding to them.
          const departureSeconds = frequencies.length > 0
            ? frequencyDepartures(frequencies, stopTimeSeconds)
            : [stopTimeSeconds]
          for (const gtfsSeconds of departureSeconds) {
            for (const serviceDate of trip.service_dates || []) {
              // Service dates reach one day before the requested range;
              // departures resolving outside it belong to a neighbouring task.
              const departure = calendarDeparture(serviceDate, gtfsSeconds)
              if (!requested.has(departure.date)) {
                continue
              }
              stopDepartures.push(StopDepartureTuple.create(
                st.stop.id,
                departure.date,
                departure.seconds,
                trip.id,
                trip.direction_id,
                route.id,
                st.pickup_type ?? null,
              ))
            }
          }
        }
      }
    }
    // A route batch expands to far more departures than a stop batch, so tuples
    // go out in bounded slices. The tripIdStrings sidecar rides on the first.
    const tripIdStringPairs: [number, string][] = [...tripIdStrings.entries()]
    let sentTripIdStrings = false
    for (const batch of chunkArray(stopDepartures, TRIP_DEPARTURE_EMIT_SIZE)) {
      emit({
        ...progressEvent(),
        partialData: {
          stopDepartures: batch,
          tripIdStrings: sentTripIdStrings ? undefined : tripIdStringPairs,
        },
      })
      sentTripIdStrings = true
    }
  }

  // A route's stop times only occur at stops it serves, so each batch filters
  // by its own routes' stops rather than repeating the whole scenario stop set
  // on every request. Without the mapping, fall back to the full set.
  const routeStopIds = config.routeStopIds
  const batches = chunkArray(routeIds, batchSize).map(ids => ({
    routeIds: ids,
    stopIds: routeStopIds
      ? [...new Set(ids.flatMap(id => routeStopIds[id] || []))]
      : config.stopIds || [],
  }))
  // An empty stop_ids filter is ignored by the backend rather than matching
  // nothing, so routes with no stops in the scenario are dropped outright.
  const fetchable = batches.filter(b => b.stopIds.length > 0)
  const skipped = batches.length - fetchable.length
  if (skipped > 0) {
    console.log(`Skipping ${skipped} route batches with no stops in the scenario`)
  }

  // One task per (route batch × 7-day window), bounding response size. A
  // departure crossing a window boundary is claimed by exactly one window.
  for (const week of chunkArray(selectedDates, 7)) {
    const dates = week.map(d => format(d, 'yyyy-MM-dd'))
    for (const batch of fetchable) {
      queue.enqueueOne({ ...batch, dates })
    }
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('departures') })
}
