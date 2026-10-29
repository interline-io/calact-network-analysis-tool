import { describe, it, expect } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient } from '../core'
import { parseStopDistance, stopDistanceQuery, stopDistanceVariables, stopPairKey, stopPairs, stopsNearQuery, stopsNearVariables, type StopDistanceResponse, type StopPoint, type StopsNearResponse } from './stop-distances'

describe('stopPairs', () => {
  it('pairs each two distinct stops once, keyed either way round', () => {
    const pairs = stopPairs([{ id: 3, lon: 0, lat: 0 }, { id: 1, lon: 0, lat: 0 }, { id: 2, lon: 0, lat: 0 }])
    expect(pairs.map(([a, b]) => stopPairKey(a.id, b.id))).toEqual(['1|3', '2|3', '1|2'])
    expect(stopPairKey(3, 1)).toBe(stopPairKey(1, 3))
  })
})

// Against the fixture transitland-server (docker/docker-compose.services.yaml).
const client = new BasicGraphQLClient(
  (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
  apiFetch(''),
)

// The fixture routes mode LINE as production does.
describe('stopDistanceQuery (integration)', () => {
  const meters = async (a: StopPoint, b: StopPoint) => {
    const result = await client.query<StopDistanceResponse>(stopDistanceQuery, stopDistanceVariables(a, b, 'LINE'))
    return parseStopDistance(result.data)
  }

  it('gets the straight-line distance between two stops from the server', async () => {
    // Two points about 219 m apart in downtown Portland, and one about 1 km
    // from them.
    const a = { id: 1, lon: -122.676447, lat: 45.517675 }
    const b = { id: 2, lon: -122.677185, lat: 45.519733 }
    const c = { id: 3, lon: -122.67, lat: 45.525 }
    const near = await meters(a, b)
    expect(near).toBeGreaterThan(200)
    expect(near).toBeLessThan(240)
    expect(await meters(a, c)).toBeGreaterThan(900)
  })
})

describe('stopsNearQuery (integration)', () => {
  // A TriMet stop's id, by its GTFS stop_id.
  const idOf = async (stopId: string) => {
    const result = await client.query<{ stops: { id: number }[] }>(gql`
      query ($stopId: String) { stops(where: { feed_onestop_id: "f-c20-trimet", stop_id: $stopId }) { id } }
    `, { stopId })
    return result.data!.stops[0]!.id
  }
  const UNION_STATION: [number, number] = [-122.6767, 45.5289]

  it('keeps the stops within a radius in meters of a point', async () => {
    // NW 6th & Flanders lies about 350 m from Union Station, and SW 5th &
    // Washington about 960 m.
    const near = await idOf('9300')
    const far = await idOf('7642')
    const within = async (meters: number) => {
      const result = await client.query<StopsNearResponse>(stopsNearQuery, stopsNearVariables([near, far], UNION_STATION, meters))
      return (result.data?.stops ?? []).map(s => s.id)
    }
    expect(await within(800)).toEqual([near])
    expect(await within(1200)).toHaveLength(2)
  })
})
