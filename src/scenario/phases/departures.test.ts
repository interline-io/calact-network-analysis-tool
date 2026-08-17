import { describe, it, expect, vi } from 'vitest'
import { frequencyDepartures, runDeparturesPhase, StopDepartureTuple, type DeparturesPhaseConfig, type StopDepartureTuple as Tuple } from './departures'
import { parseDate, type GraphQLClient } from '~~/src/core'

// 'HH:MM' to GTFS seconds and back, so expectations read as clock times. Hours
// past 24 are kept, since a generated departure can run past midnight.
function hms (s: string): number {
  const [h, m, sec = '0'] = s.split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(sec)
}

function hhmm (seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor(seconds / 60) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

class MockGraphQLClient implements GraphQLClient {
  mockQuery = vi.fn().mockResolvedValue({ data: { routes: [] } })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

// One route, one trip, one stop time at the given GTFS departure time.
function tripResponse (departureTime: string, serviceDates: string[]) {
  return {
    data: {
      routes: [{
        id: 10,
        trips: [{
          id: 100,
          direction_id: 0,
          trip_id: 't1',
          service_dates: serviceDates,
          stop_times: [{ stop: { id: 1 }, departure_time: departureTime, pickup_type: 0 }],
        }],
      }],
    },
  }
}

describe('runDeparturesPhase (trips mode)', () => {
  const baseConfig: DeparturesPhaseConfig = {
    stopIds: [1, 2, 3],
    routeIds: [10, 20],
    startDate: parseDate('2024-07-03'),
    endDate: parseDate('2024-07-03'),
  }

  // routeTripsQuery is the only query in this phase carrying `ids` + `dates`.
  function tripCalls (client: MockGraphQLClient) {
    return client.mockQuery.mock.calls
      .map(([, vars]) => vars)
      .filter(vars => vars && 'ids' in vars && 'dates' in vars)
  }

  it('filters stop times to each batch\'s own stops', async () => {
    const client = new MockGraphQLClient()
    await runDeparturesPhase({
      ...baseConfig,
      routeStopIds: { 10: [1, 2], 20: [2, 3] },
    }, client, () => {})

    const calls = tripCalls(client)
    expect(calls).toHaveLength(2)
    expect(calls.find(v => v.ids[0] === 10)?.stopIds).toEqual([1, 2])
    expect(calls.find(v => v.ids[0] === 20)?.stopIds).toEqual([2, 3])
  })

  it('skips routes with no stops in the scenario', async () => {
    const client = new MockGraphQLClient()
    await runDeparturesPhase({
      ...baseConfig,
      routeStopIds: { 10: [1, 2] },
    }, client, () => {})

    // An empty stop_ids filter is ignored by the backend, which would return
    // every stop time on the route rather than none.
    const calls = tripCalls(client)
    expect(calls).toHaveLength(1)
    expect(calls[0].ids).toEqual([10])
  })

  it('falls back to the full stop set when no mapping is supplied', async () => {
    const client = new MockGraphQLClient()
    await runDeparturesPhase(baseConfig, client, () => {})

    const calls = tripCalls(client)
    expect(calls).toHaveLength(2)
    expect(calls.map(v => v.stopIds)).toEqual([[1, 2, 3], [1, 2, 3]])
  })
})

describe('runDeparturesPhase calendar days', () => {
  // A single day, so only departures landing on it are kept.
  function config (startDate: string, endDate = startDate): DeparturesPhaseConfig {
    return {
      stopIds: [1],
      routeIds: [10],
      routeStopIds: { 10: [1] },
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
    }
  }

  async function collect (cfg: DeparturesPhaseConfig, response: object): Promise<Tuple[]> {
    const client = new MockGraphQLClient()
    client.mockQuery.mockResolvedValue(response)
    const out: Tuple[] = []
    await runDeparturesPhase(cfg, client, (p) => {
      for (const t of p.partialData?.stopDepartures || []) { out.push(t) }
    })
    return out
  }

  it('keeps a same-day departure on its service date', async () => {
    const out = await collect(config('2024-07-03'), tripResponse('08:30:00', ['2024-07-03']))
    expect(out).toHaveLength(1)
    expect(StopDepartureTuple.departureDate(out[0])).toBe('2024-07-03')
    expect(StopDepartureTuple.departureTime(out[0])).toBe(8 * 3600 + 30 * 60)
  })

  it('moves an after-midnight departure to the next calendar day at wall-clock time', async () => {
    // 25:00:00 on service date 2024-07-02 is 01:00 on 2024-07-03.
    const out = await collect(config('2024-07-03'), tripResponse('25:00:00', ['2024-07-02']))
    expect(out).toHaveLength(1)
    expect(StopDepartureTuple.departureDate(out[0])).toBe('2024-07-03')
    expect(StopDepartureTuple.departureTime(out[0])).toBe(3600)
  })

  it('drops a departure that resolves outside the requested range', async () => {
    // 25:00:00 on 2024-07-03 lands on 2024-07-04, which was not requested.
    const out = await collect(config('2024-07-03'), tripResponse('25:00:00', ['2024-07-03']))
    expect(out).toHaveLength(0)
  })

  it('claims a boundary departure exactly once across windows', async () => {
    // The trip runs both days; only the 2024-07-04 landing is in range.
    const out = await collect(
      config('2024-07-04', '2024-07-05'),
      tripResponse('25:00:00', ['2024-07-03', '2024-07-04']),
    )
    expect(out.map(t => StopDepartureTuple.departureDate(t))).toEqual(['2024-07-04', '2024-07-05'])
  })
})

describe('frequencyDepartures', () => {
  // One band, matching testdata's STBA: 06:00 to 22:00 every 30 minutes.
  function band (start: string, end: string, headway: number, anchor = '06:00:00') {
    return {
      start_time: start,
      end_time: end,
      headway_secs: headway,
      trip: { stop_times: [{ departure_time: anchor }] },
    }
  }

  it('repeats the trip from start_time, ending inclusively', () => {
    // 06:00 to 07:00 every 30 minutes, at the trip's first stop.
    expect(frequencyDepartures([band('06:00:00', '07:00:00', 1800)], hms('06:00'))
      .map(hhmm)).toEqual(['06:00', '06:30', '07:00'])
  })

  it('stops short when a headway overruns end_time', () => {
    // CITY1's first band: 06:00:00 to 07:59:59, so 08:00 is not generated.
    expect(frequencyDepartures([band('06:00:00', '07:59:59', 1800)], hms('06:00'))
      .map(hhmm)).toEqual(['06:00', '06:30', '07:00', '07:30'])
  })

  it('offsets a later stop by its distance from the first departure', () => {
    // CITY1 reaches NADAV at 06:14, fourteen minutes along the trip.
    expect(frequencyDepartures([band('06:00:00', '07:00:00', 1800)], hms('06:14'))
      .map(hhmm)).toEqual(['06:14', '06:44', '07:14'])
  })

  it('generates every band', () => {
    const bands = [band('06:00:00', '07:00:00', 1800), band('08:00:00', '08:30:00', 600)]
    expect(frequencyDepartures(bands, hms('06:00')).map(hhmm))
      .toEqual(['06:00', '06:30', '07:00', '08:00', '08:10', '08:20', '08:30'])
  })

  it('carries a generated departure past midnight', () => {
    // A 23:30 band on a trip whose stop is 90 minutes along.
    expect(frequencyDepartures([band('23:30:00', '23:30:00', 1800)], hms('07:30')))
      .toEqual([hms('25:00')])
  })

  // The anchor comes from the unfiltered trip, so a stop time earlier than it
  // cannot arise from real data; guard the arithmetic anyway.
  it('returns nothing without an anchor', () => {
    const noTrip = { start_time: '06:00:00', end_time: '07:00:00', headway_secs: 1800 }
    expect(frequencyDepartures([noTrip], hms('06:00'))).toEqual([])
    expect(frequencyDepartures([{ ...noTrip, trip: { stop_times: [] } }], hms('06:00'))).toEqual([])
  })

  it('skips a band with a non-positive headway', () => {
    expect(frequencyDepartures([band('06:00:00', '07:00:00', 0)], hms('06:00'))).toEqual([])
  })
})

describe('runDeparturesPhase frequencies', () => {
  it('replaces a frequency trip stop times with the generated departures', async () => {
    const client = new MockGraphQLClient()
    client.mockQuery.mockResolvedValue({
      data: {
        routes: [{
          id: 10,
          trips: [{
            id: 100,
            direction_id: 0,
            trip_id: 't1',
            service_dates: ['2024-07-03'],
            stop_times: [{ stop: { id: 1 }, departure_time: '06:00:00', pickup_type: 0 }],
            frequencies: [{
              start_time: '06:00:00',
              end_time: '07:00:00',
              headway_secs: 1800,
              trip: { stop_times: [{ departure_time: '06:00:00' }] },
            }],
          }],
        }],
      },
    })
    const out: Tuple[] = []
    await runDeparturesPhase(
      {
        stopIds: [1],
        routeIds: [10],
        routeStopIds: { 10: [1] },
        startDate: parseDate('2024-07-03'),
        endDate: parseDate('2024-07-03'),
      },
      client,
      (p) => { for (const t of p.partialData?.stopDepartures || []) { out.push(t) } },
    )
    // Three departures from one stop time, not the one stop time itself.
    expect(out.map(t => StopDepartureTuple.departureTime(t)))
      .toEqual([hms('06:00'), hms('06:30'), hms('07:00')])
  })
})

describe('runDeparturesPhase blank departure times', () => {
  it('drops a stop time with no departure_time', async () => {
    // Feeds may leave departure_time blank at a non-timepoint stop; parseHMS
    // returns -1, which would otherwise land on the previous day at 23:59:59.
    const client = new MockGraphQLClient()
    client.mockQuery.mockResolvedValue({
      data: {
        routes: [{
          id: 10,
          trips: [{
            id: 100,
            direction_id: 0,
            trip_id: 't1',
            service_dates: ['2024-07-03', '2024-07-04'],
            stop_times: [
              { stop: { id: 1 }, departure_time: null, pickup_type: 0 },
              { stop: { id: 2 }, departure_time: '08:00:00', pickup_type: 0 },
            ],
          }],
        }],
      },
    })
    const out: Tuple[] = []
    await runDeparturesPhase(
      {
        stopIds: [1, 2],
        routeIds: [10],
        routeStopIds: { 10: [1, 2] },
        startDate: parseDate('2024-07-03'),
        endDate: parseDate('2024-07-04'),
      },
      client,
      (p) => { for (const t of p.partialData?.stopDepartures || []) { out.push(t) } },
    )
    expect(out.map(t => StopDepartureTuple.stopId(t))).toEqual([2, 2])
    expect(out.map(t => StopDepartureTuple.departureTime(t))).toEqual([hms('08:00'), hms('08:00')])
  })
})
