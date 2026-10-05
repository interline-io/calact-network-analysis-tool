import { describe, it, expect, vi, type Mock } from 'vitest'
import { runAnalysis, type WSDOTReportConfig, type WSDOTStopResult } from './index'
import {
  parseDate,
  SCENARIO_DEFAULTS,
  type Bbox,
  type GraphQLClient,
} from '~~/src/core'
import { StopDepartureTuple, type ScenarioProgress } from '~~/src/scenario'
import { stopCensusQuery } from '~~/src/tl'

// The values the report actually puts in front of a user: which service level
// each stop qualifies for. The rest of this directory tests plumbing, and none
// of it would notice the report producing different numbers.
//
// The counterpart to report-goldens.test.ts, which pins what the real fixture
// server produces. This one runs a feed built so the expected levels are
// derivable by hand from the thresholds in service-levels.ts, which lets it
// cover service the fixture dumps do not happen to contain — trips stated past
// midnight, night segments met by exactly one departure, a stop with no
// service at all.
//
// The mock answers this branch's GraphQL queries specifically. That coupling
// is the reason the live-server goldens carry the cross-implementation check
// instead: a fixture written to the intersection of two query shapes is a
// vaguer fixture, and it hid a real defect in an earlier draft of this file.

const LEVEL_KEYS = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6'] as const
type LevelFlags = Record<(typeof LEVEL_KEYS)[number] | 'levelNights', boolean>

function flagsOf (stop: WSDOTStopResult): LevelFlags {
  return {
    level1: stop.level1,
    level2: stop.level2,
    level3: stop.level3,
    level4: stop.level4,
    level5: stop.level5,
    level6: stop.level6,
    levelNights: stop.levelNights,
  }
}

// Collects the NDJSON the run writes, so the streamed totals can be asserted
// alongside the returned report.
function capture () {
  const sent: ScenarioProgress[] = []
  const controller = {
    enqueue: (chunk: Uint8Array) => {
      for (const line of new TextDecoder().decode(chunk).split('\n')) {
        if (line.trim()) { sent.push(JSON.parse(line)) }
      }
    },
    close () {},
    error () {},
    get desiredSize () { return 1 },
  } as unknown as ReadableStreamDefaultController
  return { sent, controller }
}

// --- Hermetic suite -------------------------------------------------------------

// The three calendar days the report reads. The overnight day is the one after
// the weekday, and supplies the post-midnight half of the night segments.
const WEEKDAY = '2026-08-24' // Monday
const OVERNIGHT = '2026-08-25'
const WEEKEND = '2026-08-30' // Sunday

const FREQUENT_ROUTE = 10
const MIDDAY_ROUTE = 20
const NIGHT_ROUTE = 40

// Every departure is its own trip, so the route-direction trip counts that
// analyzeRouteFrequency works from are unambiguous.
function trip (id: number, stopId: number, hour: number, minute: number, dates: string[]) {
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return {
    id,
    trip_id: `t${id}`,
    direction_id: 0,
    service_dates: dates,
    stop_times: [{ stop: { id: stopId }, departure_time: `${hh}:${mm}:00`, pickup_type: 0 }],
    frequencies: [],
  }
}

// Six departures an hour, every hour, on all three days the report reads.
// Clears every threshold in the table, including the night segments, which
// need service in each of 23-01, 01-03, 03-05 and 02-04.
const frequentTrips = (() => {
  const trips = []
  for (let hour = 0; hour < 24; hour++) {
    for (const minute of [0, 10, 20, 30, 40, 50]) {
      trips.push(trip(1000 + hour * 6 + minute / 10, 1, hour, minute, [WEEKDAY, OVERNIGHT, WEEKEND]))
    }
  }
  return trips
})()

// One departure an hour across the eight peak hours, weekday only: eight
// departures in peak, none at night and none on the weekend.
const middayTrips = (() => {
  const trips = []
  for (let hour = 9; hour <= 16; hour++) {
    trips.push(trip(2000 + hour, 2, hour, 5, [WEEKDAY]))
  }
  return trips
})()

// Four evening departures and two past midnight, all on the weekday's service
// date — 25:30 and 27:30 are how a feed states a trip that runs into the next
// morning. The departures phase resolves those onto the following calendar day
// and the fold buckets them back to hours 1 and 3, which is the only way the
// night segments ever see the far side of midnight.
//
// Deliberately marginal: each of the four night segments ends up with exactly
// one departure, and the weekday total is exactly the 4 levelNights asks for.
// An hour bucketed one off, or a day resolved one off, drops a segment to zero.
const nightTrips = [
  trip(3001, 4, 20, 30, [WEEKDAY]),
  trip(3002, 4, 21, 30, [WEEKDAY]),
  trip(3003, 4, 22, 30, [WEEKDAY]),
  trip(3004, 4, 23, 30, [WEEKDAY]),
  trip(3005, 4, 25, 30, [WEEKDAY]),
  trip(3006, 4, 27, 30, [WEEKDAY]),
]

const ROUTES = [
  { id: FREQUENT_ROUTE, trips: frequentTrips },
  { id: MIDDAY_ROUTE, trips: middayTrips },
  { id: NIGHT_ROUTE, trips: nightTrips },
]

const FEED = {
  id: '1',
  onestop_id: 'f-1',
  feed_state: { feed_version: { id: '1', sha1: 'sha1', feed: { id: 1, onestop_id: 'f-1' } } },
}

function fixtureStop (id: number, name: string, routeIds: number[]) {
  return {
    id,
    stop_id: `stop_${id}`,
    stop_name: name,
    location_type: 0,
    geometry: { type: 'Point', coordinates: [-122.68 - id / 1000, 45.52] },
    feed_version: { sha1: 'sha1', feed: { onestop_id: 'f-1' } },
    route_stops: routeIds.map(routeId => ({ route_id: routeId, agency_id: 1 })),
  }
}

const STOPS = [
  fixtureStop(1, 'Frequent', [FREQUENT_ROUTE]),
  fixtureStop(2, 'Midday only', [MIDDAY_ROUTE]),
  // In the scenario, on no route, with no departures — the stop a broken fold
  // would make every stop look like.
  fixtureStop(3, 'Unserved', []),
  fixtureStop(4, 'Night owl', [NIGHT_ROUTE]),
]

// The stop-census phase's answers, which carry the report's stateName.
const STOP_CENSUS = STOPS.map(s => ({
  id: s.id,
  census_geographies: [{ id: 1, geoid: '53', layer_name: 'state', name: 'Washington' }],
}))

class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock = vi.fn()

  async query<T = any> (query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

// Queries are told apart by the variables only each one takes, in the same
// order run-analysis.test.ts uses. The trips query is answered per requested
// route id: the departures phase asks one route at a time, so a client that
// ignored `ids` would count every route's service against every route.
function fixtureClient () {
  const client = new MockGraphQLClient()
  let stopsServed = false
  // Resolved on a macrotask, not a microtask: a client that answers within the
  // same tick does not model a network round trip, and code that consumes its
  // own output stream behaves differently under the two.
  const reply = (data: any) => new Promise(resolve => setTimeout(() => resolve({ data }), 0))
  client.mockQuery.mockImplementation((query: any, v: any) => {
    // Dispatched on the document: the buffer queries take `ids` and `layer`
    // too, so variable names alone cannot tell this one apart.
    if (query === stopCensusQuery) { return reply({ stops: STOP_CENSUS }) }
    if (v?.tableNames !== undefined) {
      return reply({ census_datasets: [] })
    }
    if (v?.where?.bbox !== undefined) {
      return reply({ feeds: [FEED] })
    }
    if (v?.dates !== undefined) {
      const ids: number[] = v.ids || []
      return reply({ routes: ROUTES.filter(r => ids.includes(r.id)).map(r => ({ id: r.id, trips: r.trips })) })
    }
    if (v?.include_geometry !== undefined) {
      return reply({
        routes: ROUTES.map(r => ({
          id: r.id,
          route_id: `r${r.id}`,
          agency: { id: 1, agency_id: 'a', agency_name: 'A' },
        })),
      })
    }
    if (v?.after !== undefined) {
      if (stopsServed) { return reply({ stops: [] }) }
      stopsServed = true
      return reply({ stops: STOPS })
    }
    return reply({})
  })
  return client
}

const hermeticConfig: WSDOTReportConfig = {
  ...SCENARIO_DEFAULTS,
  reportName: 'report-values',
  bbox: { sw: { lat: 45.4, lon: -122.8 }, ne: { lat: 45.7, lon: -122.5 }, valid: true } as Bbox,
  startDate: parseDate(WEEKDAY),
  endDate: parseDate(WEEKEND),
  weekdayDate: parseDate(WEEKDAY)!,
  weekendDate: parseDate(WEEKEND)!,
  geographyIds: [],
  aggregateLayer: 'state',
  stopBufferRadius: 0,
  routeHourCompatMode: true,
}

// Derived from SERVICE_LEVELS, not from a previous run's output.
//
// stop_1 — 6 departures in every hour of all three days. Peak (9-16) has 6 per
// hour and 48 in total, extended (6-8, 17-21) the same, and the weekend day is
// identical, so every stop-level and route-level threshold in the table is
// met; the night segments each see service on both sides of midnight.
//
// stop_2 — 8 departures, one in each peak hour, weekday only. Level 4 wants 8
// in peak with no per-hour floor, and levels 5 and 6 want 6 and 2 trips on the
// route in a day: all met. Level 3 wants 16 in peak, level 2 wants 3 an hour,
// level 1 wants 4 an hour, and the night segments want service after midnight:
// none met.
//
// stop_4 — four evening departures and two after midnight. Level 6 wants 2
// trips on the route in a day, which it has; level 5 wants 6, and only 4 of
// them fall on the weekday. Nothing runs in peak, so levels 1-4 are out. It
// meets levelNights on the strength of the post-midnight pair alone.
//
// stop_3 — no service at all.
const EXPECTED: Record<string, LevelFlags> = {
  stop_1: {
    level1: true, level2: true, level3: true, level4: true, level5: true, level6: true, levelNights: true,
  },
  stop_2: {
    level1: false, level2: false, level3: false, level4: true, level5: true, level6: true, levelNights: false,
  },
  stop_3: {
    level1: false, level2: false, level3: false, level4: false, level5: false, level6: false, levelNights: false,
  },
  stop_4: {
    level1: false, level2: false, level3: false, level4: false, level5: false, level6: true, levelNights: true,
  },
}

describe('WSDOT report values (hermetic)', () => {
  it('classifies each stop at the levels its service earns', async () => {
    const { controller } = capture()
    const { wsdotResult } = await runAnalysis(controller, hermeticConfig, fixtureClient())

    const byStopId = new Map(wsdotResult.stops.map(s => [s.stopId, s]))
    expect([...byStopId.keys()].sort()).toEqual(['stop_1', 'stop_2', 'stop_3', 'stop_4'])

    for (const [stopId, expected] of Object.entries(EXPECTED)) {
      expect(flagsOf(byStopId.get(stopId)!), `levels for ${stopId}`).toEqual(expected)
    }

    // Every stop in the scenario is listed whether or not it has service, and
    // carries the aggregation layer's name.
    for (const stop of wsdotResult.stops) {
      expect(stop.levelAll).toBe(true)
      expect(stop.stateName).toBe('Washington')
      expect(stop.feedVersionSha1).toBe('sha1')
    }

    // The per-level stop lists the map and the level table are drawn from.
    expect(wsdotResult.levelStops.level1).toHaveLength(1)
    expect(wsdotResult.levelStops.level6).toHaveLength(3)
    expect(wsdotResult.levelStops.levelNights).toHaveLength(2)
  })

  it('folds every departure on the days the report reads, and no others', async () => {
    const { sent, controller } = capture()
    await runAnalysis(controller, hermeticConfig, fixtureClient())

    // 144 departures a day on all three report days, 8 midday on the weekday,
    // and the night route's 6 — four landing on the weekday and two on the
    // following morning. The two days fetched only to catch trips stated past
    // midnight (the day before each report day) carry no service here.
    // Departures stream to the client like browse, so the totals derive from
    // the wire tuples themselves.
    const tuples = sent.flatMap(p => p.partialData?.stopDepartures ?? [])
    expect(tuples).toHaveLength(144 * 3 + 8 + 6)
    expect(new Set(tuples.map(t => StopDepartureTuple.stopId(t))).size).toBe(3)
  })

  it('reports a stop with no service rather than dropping it', async () => {
    // The failure this whole path is shaped around is a run that comes back
    // successful and empty. A stop with no service has to arrive as a stop
    // with no service, not as a missing row.
    const { controller } = capture()
    const { wsdotResult } = await runAnalysis(controller, hermeticConfig, fixtureClient())

    const unserved = wsdotResult.stops.find(s => s.stopId === 'stop_3')
    expect(unserved).toBeDefined()
    expect(LEVEL_KEYS.some(k => unserved![k])).toBe(false)
  })
})
