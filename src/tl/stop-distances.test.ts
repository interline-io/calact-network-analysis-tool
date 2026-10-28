import { describe, it, expect } from 'vitest'
import { apiFetch, BasicGraphQLClient } from '../core'
import { parseStopDistance, stopDistanceQuery, stopDistanceVariables, stopPairKey, stopPairs, type StopDistanceResponse, type StopPoint } from './stop-distances'

describe('stopPairs', () => {
  it('pairs each two distinct stops once, keyed either way round', () => {
    const pairs = stopPairs([{ id: 3, lon: 0, lat: 0 }, { id: 1, lon: 0, lat: 0 }, { id: 2, lon: 0, lat: 0 }])
    expect(pairs.map(([a, b]) => stopPairKey(a.id, b.id))).toEqual(['1|3', '2|3', '1|2'])
    expect(stopPairKey(3, 1)).toBe(stopPairKey(1, 3))
  })
})

// Against the fixture transitland-server (docker/docker-compose.services.yaml),
// which routes mode LINE as production does.
describe('stopDistanceQuery (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )
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
