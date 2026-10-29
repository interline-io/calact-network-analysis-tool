import { describe, expect, it } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient } from '~~/src/core'
import type { VehicleTrack } from '~~/src/tl'
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

async function fetchTracks (client: BasicGraphQLClient, routeIds: number[]): Promise<VehicleTrack[]> {
  const tracks: VehicleTrack[] = []
  await runVehicleTracksPhase({ routeIds, date: DATE }, client, (progress) => {
    tracks.push(...(progress.partialData?.vehicleTracks || []))
  })
  return tracks
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
    const tracks = await fetchTracks(client, [routeId])
    expect(tracks.length).toBeGreaterThan(0)

    // The query also offers the day before as a service date; that run never
    // reaches the day, so the trip makes one run.
    const runs = tracks.filter(t => t.tripId === tripId)
    expect(runs).toHaveLength(1)
    expect(runs[0]!.routeId).toBe(routeId)
    expect(runs[0]!.times).toEqual(['05:37', '05:38', '05:39', '05:41'].map(hms))
    expect(runs[0]!.coords.slice(0, 2)).toEqual([-122.689417, 45.531434])
  })

  it('moves runs past midnight onto the day\'s clock', async () => {
    const { routeId } = await lookup(client, '100') // MAX Blue Line
    const tracks = await fetchTracks(client, [routeId])
    expect(tracks.length).toBeGreaterThan(0)
    for (const track of tracks) {
      expect(track.coords).toHaveLength(track.times.length * 2)
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
