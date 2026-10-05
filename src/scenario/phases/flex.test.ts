import { describe, it, expect, vi } from 'vitest'
import { runFlexPhase, type FlexPhaseConfig } from './flex'
import type { GraphQLClient } from '~~/src/core'

class MockGraphQLClient implements GraphQLClient {
  mockQuery = vi.fn().mockResolvedValue({ data: { feed_versions: [] } })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

// Restores an unset TZ by removing it, not by assigning `undefined` — that
// writes the string "undefined" and pins the process to a broken zone for
// every test that follows it in the same worker.
async function inZone<T> (tz: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ
  process.env.TZ = tz
  try {
    return await fn()
  } finally {
    if (previous === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = previous
    }
  }
}

describe('runFlexPhase service date', () => {
  it('queries the calendar day the config names, in any runtime zone', async () => {
    // The config crosses a JSON boundary, so startDate arrives as `yyyy-MM-dd`.
    // Read as an instant that is UTC midnight — the day before, anywhere west
    // of Greenwich — and the phase then filters flex areas against the wrong
    // day: a Saturday-only DRT zone appears or vanishes depending on where the
    // server happens to run.
    const config = {
      feedVersions: [{ feedOnestopId: 'f-1', feedVersionSha1: 'sha1' }],
      startDate: '2026-08-24',
      endDate: '2026-08-24',
    } as unknown as FlexPhaseConfig

    for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Tokyo']) {
      const client = new MockGraphQLClient()
      await inZone(tz, () => runFlexPhase(config, client, () => {}))
      const serviceDates = client.mockQuery.mock.calls
        .map(([, vars]) => vars?.serviceDate)
        .filter(Boolean)
      expect(serviceDates, `runtime in ${tz}`).toEqual(['2026-08-24'])
    }
  })
})
