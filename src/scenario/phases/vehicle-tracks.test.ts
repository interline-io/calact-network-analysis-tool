import { describe, expect, it } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient } from '~~/src/core'
import type { VehicleShape, VehicleTrack } from '~~/src/tl'
import { runVehicleTracksPhase } from './vehicle-tracks'

// Runs the phase against the live test server's TriMet fixture.

const FEED = 'f-c20-trimet'
const DATE = '2024-07-03'

function integrationClient (): BasicGraphQLClient {
  return new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
}

const routeTripQuery = gql`
query ($feed: String!, $routeId: String!, $tripId: String) {
  routes(where: {feed_onestop_id: $feed, route_id: $routeId}) {
    id
    trips(where: {trip_id: $tripId}) {
      id
    }
  }
}`

// A route's database id, and a trip's when a GTFS trip_id is given.
async function lookup (client: BasicGraphQLClient, routeId: string, tripId?: string): Promise<{ routeId: number, tripId?: number }> {
  const res = await client.query<{ routes: { id: number, trips: { id: number }[] }[] }>(routeTripQuery, { feed: FEED, routeId, tripId })
  const route = res.data?.routes[0]
  if (!route) {
    throw new Error(`route ${routeId} not found in ${FEED}`)
  }
  return { routeId: route.id, tripId: tripId ? route.trips[0]?.id : undefined }
}

async function fetchTracks (client: BasicGraphQLClient, routeIds: number[]): Promise<{ tracks: VehicleTrack[], shapes: Map<number, VehicleShape> }> {
  const tracks: VehicleTrack[] = []
  const shapes = new Map<number, VehicleShape>()
  await runVehicleTracksPhase({ routeIds, date: DATE }, client, (progress) => {
    tracks.push(...(progress.partialData?.vehicleTracks || []))
    for (const shape of progress.partialData?.vehicleShapes || []) {
      shapes.set(shape.id, shape)
    }
  })
  return { tracks, shapes }
}

// Every track's shape came with it, and its stops are in order along it.
function expectOnShapes (tracks: VehicleTrack[], shapes: Map<number, VehicleShape>) {
  for (const track of tracks) {
    const shape = shapes.get(track.shapeId)
    expect(shape, `trip ${track.tripId} shape`).toBeDefined()
    expect(shape!.coords).toHaveLength(shape!.distances.length * 2)
    expect(track.distances).toHaveLength(track.times.length)
    expect(track.distances).toEqual([...track.distances].sort((a, b) => a - b))
    expect(track.distances[track.distances.length - 1]).toBeLessThanOrEqual(shape!.distances[shape!.distances.length - 1]! + 1)
  }
}

function hms (s: string): number {
  const [h, m, sec = '0'] = s.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(sec)
}

describe('runVehicleTracksPhase (integration)', () => {
  const client = integrationClient()

  it('places a trip at each of its stops at its times', async () => {
    // Portland Streetcar NS Line, a four-stop trip leaving at 05:37.
    const { routeId, tripId } = await lookup(client, '193', '15669480')
    const { tracks, shapes } = await fetchTracks(client, [routeId])
    expect(tracks.length).toBeGreaterThan(0)
    expectOnShapes(tracks, shapes)

    // The trip runs the day before too, but that run ends before midnight, so
    // the trip makes one run on the day.
    const runs = tracks.filter(t => t.tripId === tripId)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.routeId).toBe(routeId)
    expect(runs[0]!.times).toEqual(['05:37', '05:38', '05:39', '05:41'].map(hms))
    // The first stop is at the shape's start, the next ones farther along.
    expect(runs[0]!.distances[0]).toBeLessThan(50)
    expect(runs[0]!.distances[3]).toBeGreaterThan(runs[0]!.distances[0]!)
  })

  it('moves runs past midnight onto the day\'s clock', async () => {
    const { routeId } = await lookup(client, '100') // MAX Blue Line
    const { tracks, shapes } = await fetchTracks(client, [routeId])
    expect(tracks.length).toBeGreaterThan(0)
    expectOnShapes(tracks, shapes)
    for (const track of tracks) {
      expect(track.times).toEqual([...track.times].sort((a, b) => a - b))
      // Every run reaches the day.
      expect(track.times[track.times.length - 1]).toBeGreaterThanOrEqual(0)
      expect(track.times[0]).toBeLessThanOrEqual(86400)
    }
    // The previous evening's last trains are still running after midnight,
    // and the day's own last trains run past midnight.
    expect(tracks.some(t => t.times[0]! < 0)).toBe(true)
    expect(tracks.some(t => t.times[t.times.length - 1]! > 86400)).toBe(true)
  })
})
