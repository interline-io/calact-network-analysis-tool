import { describe, it, expect } from 'vitest'
import { bearingAndDistance, centerOf, columnLabels, compassRings, compassScale, quietBearing, spreadBearings, transferCompassPlaces, transferRose } from './transfer-compass'
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
    const [sf, ...rest] = transferCompassPlaces({ from: [], to: choices }, MILLBRAE).to
    expect(rest).toEqual([])
    expect(sf).toMatchObject({ name: 'San Francisco', keys: ['a', 'b'], count: 15 })
  })

  it('keeps stations of one name in different places apart', () => {
    const twoCenters = [route([
      destination('n', 1, { terminus: 'Transit Center', terminusPoint: SF }),
      destination('s', 1, { terminus: 'Transit Center', terminusPoint: SAN_JOSE }),
    ])]
    const places = transferCompassPlaces({ from: [], to: twoCenters }, MILLBRAE).to
    expect(places.map(p => [p.name, p.keys])).toEqual([['Transit Center', ['s']], ['Transit Center', ['n']]])
  })

  it('makes one place of a station whose bays each have a point of their own', () => {
    // Hillsboro Transit Center's bays 9954 and 9955 (TriMet), 46 m apart.
    const bays = [route([
      destination('48', 5, { terminus: 'Hillsboro Transit Center', terminusPoint: [-122.984845, 45.521496] }),
      destination('47', 3, { terminus: 'Hillsboro Transit Center', terminusPoint: [-122.98544, 45.521505] }),
    ])]
    const places = transferCompassPlaces({ from: [], to: bays }, MILLBRAE).to
    expect(places.map(p => [p.name, p.keys, p.count])).toEqual([['Hillsboro Transit Center', ['48', '47'], 8]])
  })

  it('gives a station one key on both sides, so the rose has one place for it', () => {
    const arriving = [route([destination('in', 1, { origin: 'San Jose', originPoint: SAN_JOSE })])]
    const departing = [route([destination('out', 1, { terminus: 'San Jose', terminusPoint: [SAN_JOSE[0] + 0.002, SAN_JOSE[1]] })])]
    const { from, to } = transferCompassPlaces({ from: arriving, to: departing }, MILLBRAE)
    expect(from[0]!.key).toBe(to[0]!.key)
    expect(to[0]!.bearing).toBe(from[0]!.bearing)
  })

  it('places arriving destinations by where their trips start, in bearing order', () => {
    expect(transferCompassPlaces({ from: choices, to: [] }, MILLBRAE).from.map(p => p.name)).toEqual(['San Jose', 'Tamien'])
  })
})

describe('columnLabels', () => {
  const mark = (y: number, weight = 1) => ({ y, weight })

  it('keeps labels level with their marks where there is room', () => {
    expect(columnLabels([mark(-50), mark(0), mark(50)], -100, 100, 20)).toEqual([-50, 0, 50])
  })

  it('spreads crowded labels apart, within the column', () => {
    const ys = columnLabels([mark(95), mark(98), mark(100)], -100, 100, 20)
    expect(ys).toEqual([60, 80, 100])
  })

  it('passes labels around a skipped band, using the room on its far side', () => {
    // Only three fit above the band, so the four spread around it.
    expect(columnLabels([mark(-50), mark(-45), mark(-40), mark(-35)], -60, 60, 20, [-20, 20])).toEqual([-50, -30, 30, 50])
  })

  it('leaves the lightest marks unlabeled where too many to fit, keeping the rest inside', () => {
    const marks = [mark(-10, 5), mark(-5, 1), mark(0, 4), mark(5, 3), mark(10, 2)]
    expect(columnLabels(marks, -20, 20, 20)).toEqual([-20, undefined, 0, 20, undefined])
  })
})

describe('transferRose', () => {
  const ref = (key: string) => ({ key, routeId: 1, directionId: 0 })
  // A pair's connections by grade, in its overview.
  const pair = (key: string, missed: number, close: number) => ({
    to: ref(key),
    overview: { connections: missed + close, grades: [{ grade: 'missed', count: missed }, { grade: 'close', count: close }] },
  })
  const summaries = [{
    from: ref('in'),
    overview: { grades: [] },
    pairs: [pair('north', 1, 2), pair('south', 0, 1), pair('unplaced', 0, 5)],
  }] as unknown as TransferArrivalSummary[]
  const place = (name: string, bearing: number, keys: string[]) => ({ key: name, name, bearing, km: 10, keys, count: 1 })
  const compass = { from: [place('San Jose', 135, ['in'])], to: [place('San Francisco', 0, ['north']), place('Tamien', 140, ['south'])] }
  const info = {
    routes: new Map([[1, { route_id: 'R1', route_short_name: 'Local', agency_name: 'Caltrain' }]]),
    from: new Map([['in', { ...destination('in', 1, {}), label: 'San Francisco' }]]),
    to: new Map(),
  }

  it('flows from where arriving trips start to where departing ones end, leaving out unplaced ones', () => {
    const rose = transferRose(summaries, compass, info)
    expect(rose.flows.map(f => [f.from, f.to, f.total])).toEqual([['San Jose', 'San Francisco', 3], ['San Jose', 'Tamien', 1]])
    expect(rose.places.map(p => [p.name, p.total])).toEqual([['San Francisco', 3], ['San Jose', 4], ['Tamien', 1]])
    expect(rose.from.get('in')).toEqual({ route: 'Local', agency: 'Caltrain', label: 'San Francisco' })
  })

  it('gives each place the destinations whose trips start or end there', () => {
    const places = new Map(transferRose(summaries, compass, info).places.map(p => [p.name, [p.fromKeys, p.toKeys]]))
    expect(places.get('San Jose')).toEqual([['in'], []])
    expect(places.get('Tamien')).toEqual([[], ['south']])
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
