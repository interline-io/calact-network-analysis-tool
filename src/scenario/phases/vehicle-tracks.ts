// Vehicle playback: every run the scenario's routes make on one calendar day,
// as the times each vehicle is at each stop and how far along its shape that
// stop is, and the shapes the runs follow. Fetched on demand rather than with
// the scenario, since only the playback uses the runs.

import { format, subDays } from 'date-fns'
import { parseHMS, type GraphQLClient } from '~~/src/core'
import {
  routeVehicleTimetablesQuery,
  vehicleShapesQuery,
  type RouteVehicleTimetablesResponse,
  type VehiclePattern,
  type VehicleShape,
  type VehicleShapesResponse,
  type VehicleTrack,
} from '~~/src/tl'
import { phaseQueue, type PhaseEmit, type PhaseOpts } from './common'
import { frequencySchedule } from './departures'

const SECONDS_PER_DAY = 86400

export interface VehicleTracksPhaseConfig {
  routeIds: number[]
  // The playback's calendar date, `yyyy-MM-dd`.
  date: string
}

type VehicleTimetable = NonNullable<VehiclePattern['timetable']>

// Streams every run the routes make on the day, and the shapes they follow,
// one route at a time.
export async function runVehicleTracksPhase (
  config: VehicleTracksPhaseConfig,
  client: GraphQLClient,
  emit: PhaseEmit,
  opts: PhaseOpts = {},
): Promise<void> {
  // Trips from the day before that run past midnight reach the day too.
  const prev = format(subDays(new Date(`${config.date}T00:00:00`), 1), 'yyyy-MM-dd')
  const { queue, progressEvent, done } = phaseQueue<number>('vehicle-tracks', emit, routeId => fetchRoute(routeId), opts)

  async function fetchRoute (routeId: number): Promise<void> {
    const response = await client.query<{ routes: RouteVehicleTimetablesResponse[] }>(routeVehicleTimetablesQuery, {
      ids: [routeId],
      prev,
      day: config.date,
    })
    const vehicleTracks: VehicleTrack[] = []
    // A trip on each shape the runs follow, to fetch the shape through.
    const shapeTrips = new Map<number, number>()
    for (const route of response.data?.routes || []) {
      for (const [patterns, dayShift] of [[route.prev, -SECONDS_PER_DAY], [route.day, 0]] as const) {
        for (const pattern of patterns || []) {
          const table = pattern.timetable
          if (!table) {
            continue
          }
          for (let j = 0; j < table.trips.length; j++) {
            const tracks = tripTracks(table, j, route.id, dayShift)
            const shapeId = tracks[0]?.shapeId
            if (shapeId !== undefined && !shapeTrips.has(shapeId)) {
              shapeTrips.set(shapeId, table.trips[j]!.id)
            }
            vehicleTracks.push(...tracks)
          }
        }
      }
    }
    const vehicleShapes = shapeTrips.size > 0 ? await fetchShapes([...shapeTrips.values()]) : []
    await emit({ ...progressEvent(), partialData: { vehicleTracks, vehicleShapes } })
  }

  async function fetchShapes (tripIds: number[]): Promise<VehicleShape[]> {
    const response = await client.query<VehicleShapesResponse>(vehicleShapesQuery, {
      ids: tripIds,
      limit: tripIds.length,
    })
    const shapes: VehicleShape[] = []
    for (const trip of response.data?.trips || []) {
      if (trip.shape) {
        shapes.push({
          id: trip.shape.id,
          coords: trip.shape.geometry.coordinates.flatMap(c => [c[0]!, c[1]!]),
          distances: trip.shape.distances,
        })
      }
    }
    return shapes
  }

  queue.enqueue(config.routeIds)
  await queue.run()
  await done()
}

// The runs one timetable column makes on the day, moved onto the day's clock
// from its service day's. A trip without a shape makes none.
function tripTracks (table: VehicleTimetable, j: number, routeId: number, dayShift: number): VehicleTrack[] {
  const trip = table.trips[j]!
  if (!trip.shape) {
    return []
  }
  const times: number[] = []
  const distances: number[] = []
  for (let i = 0; i < table.shape_distances.values.length; i++) {
    const distance = table.shape_distances.values[i]![j]
    const arrival = parseHMS(table.arrival_times.values[i]![j])
    const departure = parseHMS(table.departure_times.values[i]![j])
    // Either side stands in for the other where the feed left one blank.
    const arrive = arrival >= 0 ? arrival : departure
    const leave = departure >= 0 ? departure : arrival
    // A stop time out of order would send the vehicle back in time; it is
    // dropped, and the vehicle drives straight on from its neighbor.
    if (distance == null || arrive < 0 || arrive < (times[times.length - 1] ?? 0)) {
      continue
    }
    times.push(arrive)
    distances.push(distance)
    if (leave > arrive) {
      times.push(leave)
      distances.push(distance)
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

  const tracks: VehicleTrack[] = []
  for (const offset of offsets) {
    const shift = dayShift + offset
    // A run from the day before that ends before midnight never reaches the day.
    if (times[times.length - 1]! + shift < 0 || times[0]! + shift > SECONDS_PER_DAY) {
      continue
    }
    tracks.push({
      tripId: trip.id,
      routeId,
      shapeId: trip.shape.id,
      times: times.map(t => t + shift),
      distances,
    })
  }
  return tracks
}
