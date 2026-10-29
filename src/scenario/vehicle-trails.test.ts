import { describe, expect, it } from 'vitest'
import type { VehicleShape, VehicleTrack } from '~~/src/tl'
import { buildTrailSegments, TRAIL_SEGMENT_FLOATS } from './vehicle-trails'

// From the world's center east along the equator and back north, with a
// corner between the two stops.
const shapes = new Map<number, VehicleShape>([[7, {
  id: 7,
  coords: [0, 0, 36, 0, 36, 36],
  distances: [0, 100, 200],
}]])

const track: VehicleTrack = {
  tripId: 1,
  routeId: 10,
  shapeId: 7,
  times: [1000, 1200],
  distances: [0, 200],
}

const colors = new Map([[10, '#ff8000']])

// Each segment's start and end times.
function segmentTimes (positions: Float32Array): number[][] {
  const out: number[][] = []
  for (let i = 0; i < positions.length; i += TRAIL_SEGMENT_FLOATS) {
    out.push([positions[i + 4]!, positions[i + 5]!])
  }
  return out
}

describe('buildTrailSegments', () => {
  it('follows the shape around its corner, timed by distance', () => {
    const segments = buildTrailSegments([track], shapes, colors, 1200, 600)
    expect(segments.count).toBe(2)
    expect(segments.origin).toEqual([0.5, 0.5])
    expect(segmentTimes(segments.positions)).toEqual([[1000, 1100], [1100, 1200]])
    // The first segment runs east to the corner, a tenth of the world over.
    expect(segments.positions[2]).toBeCloseTo(0.1, 6)
    expect(segments.positions[3]).toBeCloseTo(0, 6)
    expect([...segments.colors.subarray(0, 4)]).toEqual([255, 128, 0, 255])
  })

  it('stops where the vehicle is now', () => {
    const segments = buildTrailSegments([track], shapes, colors, 1050, 600)
    expect(segmentTimes(segments.positions)).toEqual([[1000, 1100]])
  })

  it('leaves out what the trail has faded from, and routes with no color', () => {
    expect(buildTrailSegments([track], shapes, colors, 2000, 600).count).toBe(0)
    expect(buildTrailSegments([{ ...track, routeId: 20 }], shapes, colors, 1200, 600).count).toBe(0)
    expect(buildTrailSegments([{ ...track, shapeId: 8 }], shapes, colors, 1200, 600).count).toBe(0)
  })
})
