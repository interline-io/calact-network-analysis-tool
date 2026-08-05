import { describe, it, expect, vi } from 'vitest'
import { runDeparturesPhase, type DeparturesPhaseConfig } from './departures'
import { parseDate, type GraphQLClient } from '~~/src/core'

class MockGraphQLClient implements GraphQLClient {
  mockQuery = vi.fn().mockResolvedValue({ data: { routes: [] } })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
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
    expect(calls.every(v => v.stopIds === baseConfig.stopIds)).toBe(true)
  })
})
