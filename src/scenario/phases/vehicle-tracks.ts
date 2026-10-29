// Vehicle playback: every run the scenario's routes make on one calendar day,
// as the times each vehicle is at each stop. Fetched on demand rather than
// with the scenario, since only the playback uses the runs.

import { differenceInCalendarDays } from 'date-fns'
import { parseHMS, type GraphQLClient } from '~~/src/core'
import { routeVehicleTripsQuery, type RouteVehicleTripsResponse, type VehicleTrack } from '~~/src/tl'
import { phaseQueue, type PhaseEmit, type PhaseOpts } from './common'
import { frequencySchedule } from './departures'

const SECONDS_PER_DAY = 86400

export interface VehicleTracksPhaseConfig {
  routeIds: number[]
  // The playback's calendar date, `yyyy-MM-dd`.
  date: string
}

type RouteVehicleTrip = RouteVehicleTripsResponse['trips'][number]

// Streams every run the routes make on the day, one request per route.
export async function runVehicleTracksPhase (
  config: VehicleTracksPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  const day = new Date(`${config.date}T00:00:00`)
  const { queue, progressEvent, done } = phaseQueue<number>('vehicle-tracks', emit, routeId => fetchRoute(routeId), opts)

  async function fetchRoute (routeId: number): Promise<void> {
    const response = await client.query<{ routes: RouteVehicleTripsResponse[] }>(routeVehicleTripsQuery, {
      ids: [routeId],
      dates: [config.date],
      limit: 1,
    })
    const vehicleTracks: VehicleTrack[] = []
    for (const route of response.data?.routes || []) {
      for (const trip of route.trips || []) {
        vehicleTracks.push(...tripTracks(trip, route.id, day))
      }
    }
    await emit({ ...progressEvent(), partialData: { vehicleTracks } })
  }

  queue.enqueue(config.routeIds)
  await queue.run()
  await done()
}

// The runs a trip makes on the day, moved onto the day's clock from each
// service date's own.
function tripTracks (trip: RouteVehicleTrip, routeId: number, day: Date): VehicleTrack[] {
  const times: number[] = []
  const coords: number[] = []
  const stopTimes = trip.stop_times
    .filter(st => st != null)
    .sort((a, b) => a.stop_sequence - b.stop_sequence)
  for (const st of stopTimes) {
    const point = st.stop?.geometry?.coordinates
    const arrival = parseHMS(st.arrival_time)
    const departure = parseHMS(st.departure_time)
    // Either side stands in for the other where the feed left one blank.
    const arrive = arrival >= 0 ? arrival : departure
    const leave = departure >= 0 ? departure : arrival
    // A stop time out of order would send the vehicle back in time; it is
    // dropped, and the vehicle passes straight between its neighbors.
    if (!point || arrive < 0 || arrive < (times[times.length - 1] ?? 0)) {
      continue
    }
    times.push(arrive)
    coords.push(point[0]!, point[1]!)
    if (leave > arrive) {
      times.push(leave)
      coords.push(point[0]!, point[1]!)
    }
  }
  if (times.length === 0) {
    return []
  }

  // A frequency-based trip's stop times are a template, repeated at every
  // headway; the offsets place each repetition.
  const frequencies = trip.frequencies || []
  let offsets = [0]
  if (frequencies.length > 0) {
    const schedule = frequencySchedule(frequencies)
    offsets = schedule ? schedule.starts.map(t => t - schedule.anchor) : []
  }

  // A `dates` query also reports the day before as a service date, in case the
  // trip runs past midnight; runs that never reach the day are dropped.
  const tracks: VehicleTrack[] = []
  for (const serviceDate of trip.service_dates || []) {
    const dayShift = differenceInCalendarDays(new Date(`${serviceDate}T00:00:00`), day) * SECONDS_PER_DAY
    for (const offset of offsets) {
      const shift = dayShift + offset
      if (times[times.length - 1]! + shift < 0 || times[0]! + shift > SECONDS_PER_DAY) {
        continue
      }
      tracks.push({
        tripId: trip.id,
        routeId,
        times: times.map(t => t + shift),
        coords,
      })
    }
  }
  return tracks
}
