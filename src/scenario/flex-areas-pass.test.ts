import { describe, it, expect, vi, type Mock } from 'vitest'
import type { GraphQLClient } from '~~/src/core'
import type { FeedVersion } from '~~/src/tl'
import { runFlexAreasPass } from './flex-areas-pass'
import type { ScenarioProgress } from './scenario'

class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock = vi.fn().mockResolvedValue({ data: {} })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

function makeFeedVersion (id: string): FeedVersion {
  return {
    id,
    sha1: `sha-${id}`,
    feed: { id: parseInt(id, 10), onestop_id: `f-${id}` },
  }
}

const dates = {
  startDate: new Date('2026-06-08T00:00:00'),
  endDate: new Date('2026-06-14T00:00:00'),
}

describe('runFlexAreasPass', () => {
  it('emits nothing for an empty feed-version list', async () => {
    const client = new MockGraphQLClient()
    const events: ScenarioProgress[] = []
    await runFlexAreasPass({ feedVersions: [], ...dates }, client, p => events.push(p))
    expect(events).toHaveLength(0)
    expect(client.mockQuery).not.toHaveBeenCalled()
  })

  it('queries each feed version and emits only the start event when no locations exist', async () => {
    const client = new MockGraphQLClient()
    client.mockQuery.mockResolvedValue({ data: { feed_versions: [{ locations: [] }] } })
    const events: ScenarioProgress[] = []
    await runFlexAreasPass(
      { feedVersions: [makeFeedVersion('1'), makeFeedVersion('2')], ...dates },
      client,
      p => events.push(p),
    )

    // One location query per feed version; no flex areas → no stop-times queries.
    expect(client.mockQuery).toHaveBeenCalledTimes(2)
    expect(events).toHaveLength(1)
    expect(events[0]!.currentStage).toBe('flex-areas')
    expect(events[0]!.partialData).toBeUndefined()
  })

  it('isolates per-feed-version errors and continues with the rest', async () => {
    const client = new MockGraphQLClient()
    client.mockQuery
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValue({ data: { feed_versions: [{ locations: [] }] } })
    const errors: any[] = []
    const events: ScenarioProgress[] = []
    await runFlexAreasPass(
      { feedVersions: [makeFeedVersion('1'), makeFeedVersion('2')], maxConcurrentRequests: 1, ...dates },
      client,
      p => events.push(p),
      err => errors.push(err),
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toBeInstanceOf(Error)
    // Second feed version was still queried after the first failed.
    expect(client.mockQuery).toHaveBeenCalledTimes(2)
  })
})
