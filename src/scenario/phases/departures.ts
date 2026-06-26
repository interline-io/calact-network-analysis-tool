// Phase 4: fetch stop departures (schedule data) for an explicit list of
// stop ids. This is by far the most expensive phase; taking explicit ids
// means a client can shard one scenario's departures across several
// standalone requests, each safely under proxy/CDN time limits.

import { format } from 'date-fns'
import { chunkArray, parseHMS, TaskQueue, WEEKDAY_BY_GETDAY, type GraphQLClient } from '~~/src/core'
import { stopDepartureQuery, stopTimeQuery, type StopDeparture, type StopTime } from '~~/src/tl'
import { getSelectedDateRange, PHASE_MAX_CONCURRENT_REQUESTS, phaseDone, type PhaseEmit, type PhaseOpts } from './common'
import type { ScenarioProgress } from '../scenario'

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
  departureMode?: 'all' | 'departures'
  // Stop ids per GraphQL request; default 100.
  batchSize?: number
}

export async function runDeparturesPhase (
  config: DeparturesPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
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
