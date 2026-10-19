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

describe('runFlexPhase route ids', () => {
  it('returns the routes serving each feed version\'s flex areas, for the fares phase', async () => {
    const stopTime = (routeId: number) => ({
      pickup_type: 2,
      drop_off_type: 2,
      trip: {
        trip_id: `t${routeId}`,
        route: { id: routeId, route_id: `r${routeId}`, route_type: 3, agency: { agency_id: 'a', agency_name: 'A' } },
      },
    })
    const location = (id: number, routeIds: number[]) => ({
      id,
      location_id: `loc-${id}`,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      stop_times: routeIds.map(stopTime),
    })
    const client = new MockGraphQLClient()
    client.mockQuery.mockImplementation(async (_q: any, vars: any) => vars?.serviceDate
      ? { data: { feed_versions: [{ id: 1, sha1: 'sha1', locations: [location(1, [10, 11]), location(2, [11])] }] } }
      : { data: { feed_versions: [] } })
    const result = await runFlexPhase({
      feedVersions: [{ feedOnestopId: 'f-1', feedVersionSha1: 'sha1' }],
      startDate: '2026-08-24',
      endDate: '2026-08-24',
    } as unknown as FlexPhaseConfig, client, () => {})
    expect(result.feedVersionRouteIds).toEqual({ sha1: [10, 11] })
  })
})

describe('runFlexPhase rider eligibility', () => {
  it('marks flex areas from feeds tagged as restricting rider eligibility', async () => {
    const location = (feedOnestopId: string) => ({
      id: 1,
      location_id: 'loc-1',
      feed_onestop_id: feedOnestopId,
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      stop_times: [{
        pickup_type: 2,
        drop_off_type: 2,
        trip: { trip_id: 't1', route: { id: 1, route_id: 'r1', route_type: 3, agency: { agency_id: 'a', agency_name: 'A' } } },
      }],
    })
    const feedVersion = (sha1: string, tags?: Record<string, string>) => ({
      id: 1,
      sha1,
      feed: { id: 1, onestop_id: `f-${sha1}`, tags },
      locations: [location(`f-${sha1}`)],
    })
    const client = new MockGraphQLClient()
    client.mockQuery.mockImplementation(async (_q: any, vars: any) => {
      if (!vars?.serviceDate) { return { data: { feed_versions: [] } } }
      const tags = vars.fvSha1 === 'restricted' ? { rider_eligibility_restrictions: 'true' } : undefined
      return { data: { feed_versions: [feedVersion(vars.fvSha1, tags)] } }
    })
    const restrictedByFeed: Record<string, boolean | undefined> = {}
    await runFlexPhase({
      feedVersions: [
        { feedOnestopId: 'f-restricted', feedVersionSha1: 'restricted' },
        { feedOnestopId: 'f-open', feedVersionSha1: 'open' },
      ],
      startDate: '2026-08-24',
      endDate: '2026-08-24',
    } as unknown as FlexPhaseConfig, client, (progress: any) => {
      for (const area of progress.partialData?.flexAreas ?? []) {
        restrictedByFeed[area.properties.feed_onestop_id] = area.properties.rider_eligibility_restricted
      }
    })
    expect(restrictedByFeed).toEqual({ 'f-restricted': true, 'f-open': false })
  })
})
