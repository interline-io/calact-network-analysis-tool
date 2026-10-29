import { describe, expect, it } from 'vitest'
import { shapePoint, vehicleDistance, vehiclePosition, type VehicleShape, type VehicleTrack } from './vehicle-track'

// An L-shaped shape, 10 east then 20 north.
const shape: VehicleShape = {
  id: 7,
  coords: [0, 0, 10, 0, 10, 20],
  distances: [0, 100, 300],
}

// Three stops: the shape's start, its corner, where the vehicle waits 20
// seconds, and its end.
const track: VehicleTrack = {
  tripId: 1,
  routeId: 1,
  shapeId: 7,
  times: [1000, 1100, 1120, 1320],
  distances: [0, 100, 100, 300],
}

describe('vehicleDistance', () => {
  it('is nowhere outside the run', () => {
    expect(vehicleDistance(track, 999)).toBeUndefined()
    expect(vehicleDistance(track, 1321)).toBeUndefined()
  })

  it('moves at an even speed between stops', () => {
    expect(vehicleDistance(track, 1000)).toBe(0)
    expect(vehicleDistance(track, 1050)).toBe(50)
    expect(vehicleDistance(track, 1220)).toBe(200)
  })

  it('waits at a stop between arrival and departure', () => {
    expect(vehicleDistance(track, 1110)).toBe(100)
  })
})

describe('shapePoint', () => {
  it('follows the shape between its points', () => {
    expect(shapePoint(shape, 50)).toEqual([5, 0])
    expect(shapePoint(shape, 100)).toEqual([10, 0])
    expect(shapePoint(shape, 200)).toEqual([10, 10])
  })

  it('is clamped to the shape\'s ends', () => {
    expect(shapePoint(shape, -5)).toEqual([0, 0])
    expect(shapePoint(shape, 500)).toEqual([10, 20])
  })
})

describe('vehiclePosition', () => {
  it('turns the corner with the shape', () => {
    expect(vehiclePosition(track, shape, 1050)).toEqual([5, 0])
    expect(vehiclePosition(track, shape, 1220)).toEqual([10, 10])
    expect(vehiclePosition(track, shape, 1400)).toBeUndefined()
  })
})
