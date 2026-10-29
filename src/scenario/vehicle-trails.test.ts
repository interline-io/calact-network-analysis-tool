import { describe, expect, it } from 'vitest'
import type { VehicleTrack } from '~~/src/tl'
import { buildTrailSegments, TRAIL_SEGMENT_FLOATS } from './vehicle-trails'

// From the world's center east along the equator, waiting at the second stop.
const track: VehicleTrack = {
  tripId: 1,
  routeId: 10,
  times: [1000, 1100, 1120, 1220],
  coords: [0, 0, 36, 0, 36, 0, 72, 0],
}

describe('buildTrailSegments', () => {
  it('measures segments from the first stop, leaving out the wait', () => {
    const segments = buildTrailSegments([track], new Map([[10, '#ff8000']]))
    expect(segments.count).toBe(2)
    expect(segments.origin).toEqual([0.5, 0.5])
    expect(segments.positions).toHaveLength(2 * TRAIL_SEGMENT_FLOATS)
    expect([...segments.positions].map(v => Math.round(v * 1e6) / 1e6)).toEqual([
      0, 0, 0.1, 0, 1000, 1100,
      0.1, 0, 0.2, 0, 1120, 1220,
    ])
    expect([...segments.colors]).toEqual([255, 128, 0, 255, 255, 128, 0, 255])
  })

  it('leaves out routes with no color', () => {
    const segments = buildTrailSegments([track, { ...track, routeId: 20 }], new Map([[20, '#000']]))
    expect(segments.count).toBe(2)
    expect([...segments.colors.subarray(0, 4)]).toEqual([0, 0, 0, 255])
  })
})
