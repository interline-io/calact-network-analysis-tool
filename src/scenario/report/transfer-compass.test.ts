import { describe, it, expect } from 'vitest'
import { bearingAndDistance, centerOf, sumGrades, transferCompassFlows, transferCompassPlaces } from './transfer-compass'
import type { TransferArrivalSummary, TransferRouteChoice, TransferTripDestination } from './transfers'

const MILLBRAE: [number, number] = [-122.387, 37.600]
const SF: [number, number] = [-122.395, 37.776]
const SAN_JOSE: [number, number] = [-121.903, 37.330]

function destination (key: string, count: number, run: TransferTripDestination['run']): TransferTripDestination {
  return { key, label: key, sign: key, count, run, namedByOrigin: false, terminal: 0 }
}

function route (destinations: TransferTripDestination[]): TransferRouteChoice {
  return { id: 1, label: '1', longName: '', operator: '', count: 0, directions: [{ directionId: 0, label: '', count: 0, destinations }] }
}

describe('bearingAndDistance', () => {
  it('measures bearing clockwise from north, and distance in km', () => {
    const north = bearingAndDistance(MILLBRAE, SF)
    expect(north.bearing > 355 || north.bearing < 5).toBe(true)
    expect(north.km).toBeGreaterThan(18)
    expect(north.km).toBeLessThan(21)
    const southeast = bearingAndDistance(MILLBRAE, SAN_JOSE)
    expect(southeast.bearing).toBeGreaterThan(120)
    expect(southeast.bearing).toBeLessThan(150)
  })
})

describe('centerOf', () => {
  it('averages points, and has none for none', () => {
    expect(centerOf([[0, 0], [2, 4]])).toEqual([1, 2])
    expect(centerOf([])).toBeUndefined()
  })
})

describe('transferCompassPlaces', () => {
  const choices = [route([
    destination('a', 10, { origin: 'San Jose', terminus: 'San Francisco', originPoint: SAN_JOSE, terminusPoint: SF }),
    destination('b', 5, { origin: 'Tamien', terminus: 'San Francisco', originPoint: [-121.883, 37.311], terminusPoint: SF }),
    destination('c', 2, { origin: 'Nowhere', terminus: 'Unknown' }),
  ])]

  it('gathers departing destinations by where their trips end', () => {
    const [sf, ...rest] = transferCompassPlaces(choices, 'to', MILLBRAE)
    expect(rest).toEqual([])
    expect(sf).toMatchObject({ name: 'San Francisco', keys: ['a', 'b'], count: 15 })
  })

  it('places arriving destinations by where their trips start, in bearing order', () => {
    expect(transferCompassPlaces(choices, 'from', MILLBRAE).map(p => p.name)).toEqual(['San Jose', 'Tamien'])
  })
})

describe('transferCompassFlows', () => {
  const ref = (key: string) => ({ key, routeId: 1, directionId: 0 })
  const summaries = [{
    from: ref('in'),
    overview: { grades: [{ grade: 'close', count: 3 }, { grade: 'missed', count: 1 }] },
    pairs: [
      { to: ref('out1'), missed: 1, close: 2, acceptable: 0, unacceptable: 0 },
      { to: ref('out2'), missed: 0, close: 1, acceptable: 0, unacceptable: 0 },
    ],
  }] as unknown as TransferArrivalSummary[]

  it('counts connections by grade from arriving destinations and onto departing ones', () => {
    expect(transferCompassFlows(summaries, 'from').get('in')).toEqual({ missed: 1, close: 3, acceptable: 0, unacceptable: 0 })
    const to = transferCompassFlows(summaries, 'to')
    expect(sumGrades(to, ['out1', 'out2', 'none'])).toEqual({ missed: 1, close: 3, acceptable: 0, unacceptable: 0 })
  })
})
