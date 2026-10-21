import { describe, it, expect } from 'vitest'
import { apiFetch, BasicGraphQLClient } from '../core'
import { parseStopDistances, stopDistancesRequest, stopPairKey, stopPairs, type StopDistancesResponse } from './stop-distances'

describe('stopPairs', () => {
  it('pairs each two distinct stops once, keyed either way round', () => {
    const pairs = stopPairs([{ id: 3, lon: 0, lat: 0 }, { id: 1, lon: 0, lat: 0 }, { id: 2, lon: 0, lat: 0 }])
    expect(pairs.map(([a, b]) => stopPairKey(a.id, b.id))).toEqual(['1|3', '2|3', '1|2'])
    expect(stopPairKey(3, 1)).toBe(stopPairKey(1, 3))
  })
})

describe('parseStopDistances', () => {
  it('reads each pair in meters, leaving out pairs the server could not route', () => {
    const pairs = stopPairs([{ id: 1, lon: 0, lat: 0 }, { id: 2, lon: 0, lat: 0 }, { id: 3, lon: 0, lat: 0 }])
    const meters = parseStopDistances(pairs, {
      p0: { success: true, distance: { distance: 0.25, units: 'KILOMETERS' } },
      p1: { success: false, distance: null },
      p2: { success: true, distance: { distance: 1, units: 'MILES' } },
    })
    expect(meters.get('1|2')).toBe(250)
    expect(meters.has('1|3')).toBe(false)
    expect(meters.get('2|3')).toBeCloseTo(1609.344)
  })
})

// Against the fixture transitland-server (docker/docker-compose.services.yaml),
// which routes mode LINE as production does.
describe('stopDistancesRequest (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )

  it('gets straight-line distances between stops from the server', async () => {
    // Two points about 219 m apart in downtown Portland, and one about 1 km
    // from them.
    const pairs = stopPairs([
      { id: 1, lon: -122.676447, lat: 45.517675 },
      { id: 2, lon: -122.677185, lat: 45.519733 },
      { id: 3, lon: -122.67, lat: 45.525 },
    ])
    const { query, variables } = stopDistancesRequest(pairs, 'LINE')
    const result = await client.query<StopDistancesResponse>(query, variables)
    const meters = parseStopDistances(pairs, result.data)
    expect(meters.get('1|2')).toBeGreaterThan(200)
    expect(meters.get('1|2')).toBeLessThan(240)
    expect(meters.get('1|3')).toBeGreaterThan(900)
    expect(meters.size).toBe(3)
  })
})
