import { describe, it, expect, vi, type Mock } from 'vitest'
import type { GraphQLClient } from '~~/src/core'
import { runBufferPasses } from './buffer-passes'
import type { ScenarioProgress } from './scenario'

// Unit tests for runBufferPasses chunking + bufferProgress math. The entity
// and intersection fetchers tolerate empty GraphQL responses, so a mock
// client is enough — each chunk and Pass F issue exactly one query.
class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock = vi.fn().mockResolvedValue({ data: {} })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

function idRange (n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1)
}

async function run (stopCount: number, routeCount: number, agencyCount: number): Promise<{ events: ScenarioProgress[], client: MockGraphQLClient }> {
  const client = new MockGraphQLClient()
  const events: ScenarioProgress[] = []
  await runBufferPasses({
    radius: 400,
    layer: 'tract',
    geoDatasetName: 'tiger2024',
    tableDatasetName: 'acsdt5y2021',
    stopIds: idRange(stopCount),
    routeIds: idRange(routeCount),
    agencyIds: idRange(agencyCount),
  }, client, p => events.push(p))
  return { events, client }
}

describe('runBufferPasses progress', () => {
  it('emits nothing for empty id sets', async () => {
    const { events, client } = await run(0, 0, 0)
    expect(events).toHaveLength(0)
    expect(client.mockQuery).not.toHaveBeenCalled()
  })

  it('reports bufferProgress across all chunks plus the aggregation pass', async () => {
    // Default chunk sizes: 100 stops, 50 routes/agencies.
    // 250 stops → 3 chunks, 60 routes → 2, 50 agencies → 1, +1 aggregation.
    const { events, client } = await run(250, 60, 50)
    const expectedTotal = 3 + 2 + 1 + 1

    expect(events).toHaveLength(expectedTotal)
    expect(client.mockQuery).toHaveBeenCalledTimes(expectedTotal)

    // Stages arrive in pass order.
    expect(events.map(e => e.currentStage)).toEqual([
      'stop-buffer-geographies',
      'stop-buffer-geographies',
      'stop-buffer-geographies',
      'route-buffer-geographies',
      'route-buffer-geographies',
      'agency-buffer-geographies',
      'aggregation-buffer-geographies',
    ])

    // Every event carries the same total; completed counts up monotonically.
    for (const [i, e] of events.entries()) {
      expect(e.bufferProgress).toEqual({ total: expectedTotal, completed: i + 1 })
    }
    expect(events[events.length - 1]!.bufferProgress!.completed).toBe(expectedTotal)
  })

  it('skips the aggregation pass when there are no stops', async () => {
    const { events } = await run(0, 10, 0)
    expect(events).toHaveLength(1)
    expect(events[0]!.currentStage).toBe('route-buffer-geographies')
    expect(events[0]!.bufferProgress).toEqual({ total: 1, completed: 1 })
  })

  it('respects custom chunk sizes', async () => {
    const client = new MockGraphQLClient()
    const events: ScenarioProgress[] = []
    await runBufferPasses({
      radius: 400,
      layer: 'tract',
      geoDatasetName: 'tiger2024',
      tableDatasetName: 'acsdt5y2021',
      stopIds: idRange(10),
      routeIds: [],
      agencyIds: [],
      stopChunkSize: 4,
    }, client, p => events.push(p))

    // ceil(10/4) = 3 stop chunks + 1 aggregation.
    expect(events).toHaveLength(4)
    expect(events[0]!.bufferProgress).toEqual({ total: 4, completed: 1 })
    expect(events[3]!.currentStage).toBe('aggregation-buffer-geographies')
    expect(events[3]!.bufferProgress).toEqual({ total: 4, completed: 4 })
  })
})
