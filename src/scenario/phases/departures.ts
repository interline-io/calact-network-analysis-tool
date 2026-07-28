// Phase 4: fetch stop departures (schedule data) for an explicit list of
// stop ids. This is by far the most expensive phase; taking explicit ids
// means a client can shard one scenario's departures across several
// standalone requests, each safely under proxy/CDN time limits.

import { format } from 'date-fns'
import { chunkArray, parseHMS, TaskQueue, WEEKDAY_BY_GETDAY, type GraphQLClient } from '~~/src/core'
import { routeTripsQuery, stopDepartureQuery, stopTimeQuery, type RouteTripsResponse, type StopDeparture, type StopTime } from '~~/src/tl'
import { getSelectedDateRange, PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type PhaseEmit, type PhaseOpts } from './common'
import type { DepartureMode, ScenarioProgress } from '../scenario'

// Effectively "no batching" — departures for a fetch stream as one batch.
const PROGRESS_LIMIT_STOP_DEPARTURES = 100_000_000

// Stop ids per departure query.
const DEPARTURE_BATCH_SIZE = 100

// Define the tuple type with named fields
// Optimized wire format: departure_time as seconds, no string trip_id
export type StopDepartureTuple = readonly [
  stop_id: number,
  departure_date: string,
  departure_time: number, // seconds since midnight
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
  fromStopTime: (stopId: number, departureDate: string, stopDeparture: StopTime) => StopDepartureTuple.create(
    stopId,
    departureDate,
    parseHMS(stopDeparture.departure_time),
    stopDeparture.trip.id,
    stopDeparture.trip.direction_id,
    stopDeparture.trip.route.id,
    stopDeparture.pickup_type ?? null,
  ),
  stopId: (tuple: StopDepartureTuple) => tuple[0],
  departureDate: (tuple: StopDepartureTuple) => tuple[1],
  departureTime: (tuple: StopDepartureTuple) => tuple[2],
  tripId: (tuple: StopDepartureTuple) => tuple[3],
  tripDirectionId: (tuple: StopDepartureTuple) => tuple[4],
  tripRouteId: (tuple: StopDepartureTuple) => tuple[5],
  pickupType: (tuple: StopDepartureTuple) => tuple[6],
}

export class StopDepartureQueryVars {
  ids: number[] = []
  monday: string = ''
  tuesday: string = ''
  wednesday: string = ''
  thursday: string = ''
  friday: string = ''
  saturday: string = ''
  sunday: string = ''
  include_monday: boolean = false
  include_tuesday: boolean = false
  include_wednesday: boolean = false
  include_thursday: boolean = false
  include_friday: boolean = false
  include_saturday: boolean = false
  include_sunday: boolean = false

  get (dow: string): string {
    switch (dow) {
      case 'monday':
        return this.monday
      case 'tuesday':
        return this.tuesday
      case 'wednesday':
        return this.wednesday
      case 'thursday':
        return this.thursday
      case 'friday':
        return this.friday
      case 'saturday':
        return this.saturday
      case 'sunday':
        return this.sunday
    }
    return ''
  }

  setDay (d: Date) {
    const dateFmt = 'yyyy-MM-dd'
    switch (d.getDay()) {
      case 0:
        this.sunday = format(d, dateFmt)
        this.include_sunday = true
        break
      case 1:
        this.monday = format(d, dateFmt)
        this.include_monday = true
        break
      case 2:
        this.tuesday = format(d, dateFmt)
        this.include_tuesday = true
        break
      case 3:
        this.wednesday = format(d, dateFmt)
        this.include_wednesday = true
        break
      case 4:
        this.thursday = format(d, dateFmt)
        this.include_thursday = true
        break
      case 5:
        this.friday = format(d, dateFmt)
        this.include_friday = true
        break
      case 6:
        this.saturday = format(d, dateFmt)
        this.include_saturday = true
        break
    }
  }
}

export interface DeparturesPhaseConfig {
  stopIds: number[]
  startDate?: Date
  endDate?: Date
  departureMode?: DepartureMode
  // Stop ids per GraphQL request; default 100.
  batchSize?: number
  // Required by the 'trips' mode, which enters via route rather than stop.
  routeIds?: number[]
  // Routes per GraphQL request in 'trips' mode; default 50.
  routeBatchSize?: number
}

export async function runDeparturesPhase (
  config: DeparturesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  if (config.departureMode === 'trips') {
    return runDeparturesTripsPhase(config, client, emit, opts)
  }
  const batchSize = config.batchSize ?? DEPARTURE_BATCH_SIZE

  const queue: TaskQueue<StopDepartureQueryVars> = new TaskQueue<StopDepartureQueryVars>(
    PHASE_MAX_CONCURRENT_REQUESTS,
    task => fetchStopDepartures(task),
    {
      onProgress: () => { emit(progressEvent()) },
      onError: error => opts.onError?.(error),
    }
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

  async function fetchStopDepartures (task: StopDepartureQueryVars): Promise<void> {
    if (task.ids.length === 0) {
      return
    }
    const fetchDates = WEEKDAY_BY_GETDAY.filter(s => task.get(s)).map(s => `${s.slice(0, 2)}:${task.get(s)}`).join(', ')
    console.log(`Fetching stop departures for ${task.ids.length} stops on dates ${fetchDates}`)
    const q = config.departureMode === 'departures' ? stopDepartureQuery : stopTimeQuery
    const response = await client.query<{ stops: StopDeparture[] }>(q, task)
    // Map into simpler format for wire format
    const stopDepartures: StopDepartureTuple[] = []
    const tripIdStrings = new Map<number, string>()
    for (const stop of response.data?.stops || []) {
      for (const dow of WEEKDAY_BY_GETDAY) {
        const dowDate = task.get(dow)
        if (!dowDate) {
          continue
        }
        const stopTimes = (() => {
          switch (dow) {
            case 'monday':
              return stop.monday || []
            case 'tuesday':
              return stop.tuesday || []
            case 'wednesday':
              return stop.wednesday || []
            case 'thursday':
              return stop.thursday || []
            case 'friday':
              return stop.friday || []
            case 'saturday':
              return stop.saturday || []
            case 'sunday':
              return stop.sunday || []
            default:
              return []
          }
        })()
        for (const st of stopTimes) {
          stopDepartures.push(StopDepartureTuple.fromStopTime(stop.id, dowDate, st))
          if (st.trip.trip_id && !tripIdStrings.has(st.trip.id)) {
            tripIdStrings.set(st.trip.id, st.trip.trip_id)
          }
        }
      }
    }

    // Send progress updates in batches using the generic helper function.
    // The tripIdStrings sidecar rides on the first batch; subsequent batches
    // in the same fetch would only duplicate the same entries, so we clear it.
    const tripIdStringPairs: [number, string][] = [...tripIdStrings.entries()]
    let sentTripIdStrings = false
    for (const stopDepartureBatch of chunkArray(stopDepartures, PROGRESS_LIMIT_STOP_DEPARTURES)) {
      emit({
        ...progressEvent(),
        partialData: {
          stopDepartures: stopDepartureBatch,
          tripIdStrings: sentTripIdStrings ? undefined : tripIdStringPairs,
        },
      })
      sentTripIdStrings = true
    }
  }

  // Build all tasks first: stop id chunks × 7-day windows
  const dates = getSelectedDateRange(config)
  const weekSize = 7
  for (let sid = 0; sid < config.stopIds.length; sid += batchSize) {
    for (let i = 0; i < dates.length; i += weekSize) {
      const w = new StopDepartureQueryVars()
      w.ids = config.stopIds.slice(sid, sid + batchSize)
      for (const d of dates.slice(i, i + weekSize)) {
        w.setDay(d)
      }
      queue.enqueueOne(w)
    }
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('departures') })
}

// Routes per GraphQL request. Deliberately 1: batching routes returns silently
// incomplete data — the server answers 200 with fewer trips as the batch grows,
// and accuracy converges only at 1 (see the batch sweep in the PR notes).
const TRIP_ROUTE_BATCH_SIZE = 1

// Tuples per emitted progress event. One route batch can expand to hundreds of
// thousands of departures, and each event is a single NDJSON line.
const TRIP_DEPARTURE_EMIT_SIZE = 50_000

interface TripFetchTask {
  routeIds: number[]
  // One week of requested dates, as `yyyy-MM-dd`.
  dates: string[]
  // Weekday (0-6) -> the requested date, for relabelling service-window hits.
  byWeekday: Map<number, string>
}

// Departures via route -> trips -> stop_times instead of per (stop, date).
// The backend states each trip's identity and service dates once and returns
// its stop times undated; this expands them back into the same flat
// StopDepartureTuple stream the stop-oriented phase emits, so nothing
// downstream changes.
async function runDeparturesTripsPhase (
  config: DeparturesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const routeIds = config.routeIds || []
  const stopIds = config.stopIds || []
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
    const { routeIds: chunk, dates, byWeekday } = task
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
        for (const st of trip.stop_times || []) {
          const departureTime = parseHMS(st.departure_time)
          for (const date of trip.service_dates || []) {
            // `use_service_window` can move a requested date into the feed
            // version's fallback week, and the server reports where it landed.
            // The stop-oriented phase labels its tuples with the date the
            // caller asked for; match that, or the scenario's own date filter
            // drops them. The mapping preserves weekday, so that identifies it.
            const requested = byWeekday.get(new Date(`${date}T00:00:00`).getDay()) ?? date
            stopDepartures.push(StopDepartureTuple.create(
              st.stop.id,
              requested,
              departureTime,
              trip.id,
              trip.direction_id,
              route.id,
              st.pickup_type ?? null,
            ))
          }
        }
      }
    }
    // A route batch expands to far more departures than a stop batch does, so
    // the tuples are emitted in bounded slices rather than one array per
    // request. The tripIdStrings sidecar rides on the first slice; later ones
    // would only repeat it.
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

  // One task per (route batch × 7-day window). Weekday identifies a requested
  // date only within a single week, which is also why the stop-oriented phase
  // batches by week.
  for (const week of chunkArray(selectedDates, 7)) {
    const dates = week.map(d => format(d, 'yyyy-MM-dd'))
    const byWeekday = new Map<number, string>()
    for (const d of week) {
      byWeekday.set(d.getDay(), format(d, 'yyyy-MM-dd'))
    }
    for (const chunk of chunkArray(routeIds, batchSize)) {
      queue.enqueueOne({ routeIds: chunk, dates, byWeekday })
    }
  }
  await queue.run()
  emit({ ...progressEvent(), phaseProgress: phaseDone('departures') })
}
