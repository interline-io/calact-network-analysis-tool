import { describe, expect, it } from 'vitest'
import { vehiclePosition, type VehicleTrack } from './vehicle-track'

// Three stops 100 seconds apart, waiting 20 seconds at the middle one.
const track: VehicleTrack = {
  tripId: 1,
  routeId: 1,
  times: [1000, 1100, 1120, 1220],
  coords: [0, 0, 10, 20, 10, 20, 30, 20],
}

describe('vehiclePosition', () => {
  it('is nowhere outside the run', () => {
    expect(vehiclePosition(track, 999)).toBeUndefined()
    expect(vehiclePosition(track, 1221)).toBeUndefined()
  })

  it('is at a stop at its time', () => {
    expect(vehiclePosition(track, 1000)).toEqual([0, 0])
    expect(vehiclePosition(track, 1220)).toEqual([30, 20])
  })

  it('moves in a straight line between stops', () => {
    expect(vehiclePosition(track, 1050)).toEqual([5, 10])
    expect(vehiclePosition(track, 1170)).toEqual([20, 20])
  })

  it('waits at a stop between arrival and departure', () => {
    expect(vehiclePosition(track, 1110)).toEqual([10, 20])
  })
})
