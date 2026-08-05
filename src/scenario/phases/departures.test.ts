import { describe, it, expect, vi } from 'vitest'
import { runDeparturesPhase, StopDepartureTuple, type DeparturesPhaseConfig, type StopDepartureTuple as Tuple } from './departures'
import { parseDate, type GraphQLClient } from '~~/src/core'

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
