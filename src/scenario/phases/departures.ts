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

// Routes per GraphQL request. One, because that is the shape this phase's
// measured performance was established with.
//
// Larger batches are no longer incorrect — the pinned backend fixed the
// feed-version bug that made them silently incomplete, and 40 routes over a week
// return identical departures batched or not — but they have not been shown to
// be faster. Eight requests are already in flight, so batching trades more
// concurrency for less, and a batch's stop filter is the union of its routes'
// stops, which matches every route in it against stops it does not serve.
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
  // Explicit calendar dates (`yyyy-MM-dd`) to fetch, instead of every day from
  // startDate to endDate. A consumer that reads a few days out of a wide
  // scenario range pays for those days rather than for the range. Callers must
  // include the day before each date they care about: a departure stated past
  // 24:00:00 belongs to the day after its service date.
  dates?: string[]
  // Routes per GraphQL request; see TRIP_ROUTE_BATCH_SIZE for the default.
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
function shiftDates (serviceDates: string[], days: number): string[] {
  if (days === 0) {
    return serviceDates
  }
  return serviceDates.map((serviceDate) => {
    const d = new Date(`${serviceDate}T00:00:00`)
    d.setDate(d.getDate() + days)
    return format(d, 'yyyy-MM-dd')
  })
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
  const schedule = frequencySchedule(frequencies)
  if (!schedule) {
    return []
  }
  const offset = stopTimeSeconds - schedule.anchor
  return schedule.starts.map(t => t + offset)
}

// The same series before any stop's offset is applied, which is everything about
// it that depends on the trip rather than the stop. Worth computing once: a trip
// with fifty in-scenario stops would otherwise re-derive the anchor and re-parse
// every band fifty times over.
export function frequencySchedule (frequencies: RouteTripFrequency[]): { anchor: number, starts: number[] } | null {
  const anchor = frequencyAnchor(frequencies)
  if (anchor === null) {
    return null
  }
  const starts: number[] = []
  for (const f of frequencies) {
    if (f.headway_secs <= 0) {
      continue
    }
    const end = parseHMS(f.end_time)
    for (let t = parseHMS(f.start_time); t <= end; t += f.headway_secs) {
      starts.push(t)
    }
  }
  return { anchor, starts }
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
  // `undefined` means the caller did not narrow the range; `[]` means it
  // narrowed to nothing. Treating them alike would have a caller that computed
  // zero dates run the widest query there is.
  const selectedDates = config.dates
    ? [...config.dates]
    : getSelectedDateRange(config).map(d => format(d, 'yyyy-MM-dd'))
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
      currentStage: 'departures',
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
        // date the trip runs. Everything that depends only on the trip is
        // computed here rather than per stop time, which is the hot loop.
        const frequencies = trip.frequencies || []
        const schedule = frequencies.length > 0 ? frequencySchedule(frequencies) : null
        const serviceDates = trip.service_dates || []
        const datesByDayShift = new Map<number, string[]>()
        for (const st of trip.stop_times || []) {
          const stopTimeSeconds = parseHMS(st.departure_time)
          // A feed may leave departure_time blank at a non-timepoint stop.
          // Keeping one would resolve -1 seconds onto the previous day at
          // 23:59:59, so it is dropped as the stop-oriented path's time window
          // dropped it.
          if (stopTimeSeconds < 0) {
            continue
          }
          // A frequency-based trip's generated departures replace its stop
          // times rather than adding to them.
          const departureSeconds = frequencies.length > 0
            ? (schedule ? schedule.starts.map(t => t + stopTimeSeconds - schedule.anchor) : [])
            : [stopTimeSeconds]
          for (const gtfsSeconds of departureSeconds) {
            if (gtfsSeconds < 0) {
              continue
            }
            // Seconds past 24:00:00 mean the departure falls on a later calendar
            // day than the service date. The shift is the same for every stop
            // time of a trip, so it is resolved once per distinct day offset.
            const days = Math.floor(gtfsSeconds / SECONDS_PER_DAY)
            let dates = datesByDayShift.get(days)
            if (!dates) {
              dates = shiftDates(serviceDates, days)
              datesByDayShift.set(days, dates)
            }
            for (const date of dates) {
              // Service dates reach one day before the requested range;
              // departures resolving outside it belong to a neighbouring task.
              if (!requested.has(date)) {
                continue
              }
              stopDepartures.push(StopDepartureTuple.create(
                st.stop.id,
                date,
                gtfsSeconds,
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
      await emit({
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
  // Dropped before batching rather than after: a route with no stops in the
  // scenario can return nothing, and batched alongside routes that do have
  // stops it would be fetched anyway.
  const fetchableRouteIds = routeStopIds
    ? routeIds.filter(id => (routeStopIds[id] || []).length > 0)
    : routeIds
  const skipped = routeIds.length - fetchableRouteIds.length
  if (skipped > 0) {
    console.log(`Skipping ${skipped} routes with no stops in the scenario`)
  }
  const batches = chunkArray(fetchableRouteIds, batchSize).map(ids => ({
    routeIds: ids,
    stopIds: routeStopIds
      ? [...new Set(ids.flatMap(id => routeStopIds[id] || []))]
      : config.stopIds || [],
  }))
  // An empty stop_ids filter is ignored by the backend rather than matching
  // nothing, so a batch without one is not worth issuing.
  const fetchable = batches.filter(b => b.stopIds.length > 0)

  // One task per (route batch × 7-day window), bounding response size. A
  // departure crossing a window boundary is claimed by exactly one window.
  for (const dates of chunkArray(selectedDates, 7)) {
    for (const batch of fetchable) {
      queue.enqueueOne({ ...batch, dates })
    }
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('departures') })
}
