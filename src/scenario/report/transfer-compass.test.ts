import { describe, it, expect } from 'vitest'
import { bearingAndDistance, centerOf, compassRings, compassScale, quietBearing, spreadBearings, transferCompassPlaces, transferRose } from './transfer-compass'
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

  it('keeps stations of one name in different places apart', () => {
    const twoCenters = [route([
      destination('n', 1, { terminus: 'Transit Center', terminusPoint: SF }),
      destination('s', 1, { terminus: 'Transit Center', terminusPoint: SAN_JOSE }),
    ])]
    const places = transferCompassPlaces(twoCenters, 'to', MILLBRAE)
    expect(places.map(p => [p.name, p.keys])).toEqual([['Transit Center', ['s']], ['Transit Center', ['n']]])
  })

  it('places arriving destinations by where their trips start, in bearing order', () => {
    expect(transferCompassPlaces(choices, 'from', MILLBRAE).map(p => p.name)).toEqual(['San Jose', 'Tamien'])
  })
})

describe('transferRose', () => {
  const ref = (key: string) => ({ key, routeId: 1, directionId: 0 })
  const summaries = [{
    from: ref('in'),
    overview: { grades: [] },
    pairs: [
      { to: ref('north'), missed: 1, close: 2, acceptable: 0, unacceptable: 0 },
      { to: ref('south'), missed: 0, close: 1, acceptable: 0, unacceptable: 0 },
      { to: ref('unplaced'), missed: 0, close: 5, acceptable: 0, unacceptable: 0 },
    ],
  }] as unknown as TransferArrivalSummary[]
  const place = (name: string, bearing: number, keys: string[]) => ({ key: name, name, bearing, km: 10, keys, count: 1 })
  const compass = { from: [place('San Jose', 135, ['in'])], to: [place('San Francisco', 0, ['north']), place('Tamien', 140, ['south'])] }
  const info = {
    routes: new Map([[1, { route_id: 'R1', route_short_name: 'Local', agency_name: 'Caltrain' }]]),
    from: new Map([['in', { ...destination('in', 1, {}), label: 'San Francisco', routeId: 1 }]]),
    to: new Map(),
  }

  it('flows from where arriving trips start to where departing ones end, leaving out unplaced ones', () => {
    const rose = transferRose(summaries, compass, info)
    expect(rose.flows.map(f => [f.from, f.to, f.total])).toEqual([['San Jose', 'San Francisco', 3], ['San Jose', 'Tamien', 1]])
    expect(rose.places.map(p => p.name)).toEqual(['San Francisco', 'San Jose', 'Tamien'])
    expect(rose.from.get('in')).toEqual({ route: 'Local', agency: 'Caltrain', label: 'San Francisco' })
  })
})

describe('compassScale', () => {
  it('spreads near places out on a log scale, the farthest at the edge', () => {
    expect(compassScale(0, 160)).toBe(0)
    expect(compassScale(160, 160)).toBe(1)
    expect(compassScale(10, 160)).toBeGreaterThan(0.45)
    expect(compassRings(160)).toEqual([3, 10, 30, 100])
  })
})

describe('quietBearing', () => {
  it('finds the middle of the widest gap between bearings, across north too', () => {
    expect(quietBearing([0, 90, 180])).toBe(270)
    expect(quietBearing([300, 60])).toBe(180)
    expect(quietBearing([])).toBe(45)
  })
})

describe('spreadBearings', () => {
  it('fans apart places either side of north', () => {
    const [a, b] = spreadBearings([358, 2], 10)
    expect(((b! - a!) % 360 + 360) % 360).toBeCloseTo(10)
  })

  it('leaves places far enough apart as they are', () => {
    expect(spreadBearings([10, 100, 200], 10).map(a => Math.round(a % 360))).toEqual([10, 100, 200])
  })
})
