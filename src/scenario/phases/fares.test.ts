import { describe, it, expect, vi } from 'vitest'
import { runFaresPhase } from './fares'
import { fareRoutesQuery, fareStopsQuery, feedVersionFaresQuery, type FeedVersionFaresGql, type RouteFareSummary } from '~~/src/tl'
import type { GraphQLClient } from '~~/src/core'
import type { ScenarioProgress } from '../scenario'

function fvFares (partial: Partial<FeedVersionFaresGql>): FeedVersionFaresGql {
  return {
    fare_attributes: [],
    fare_rules: [],
    fare_leg_rules: [],
    fare_products: [],
    rider_categories: [],
    ...partial,
  }
}

// Answers each of the phase's three queries from per-sha1 / per-id fixtures.
function mockClient (fares: Record<string, FeedVersionFaresGql>, stops: Record<number, any> = {}) {
  const query = vi.fn(async (q: any, vars: any) => {
    if (q === feedVersionFaresQuery) {
      return { data: { feed_versions: fares[vars.sha1] ? [fares[vars.sha1]] : [] } }
    }
    if (q === fareRoutesQuery) {
      return { data: { routes: vars.ids.map((id: number) => ({ id, network_id: null, networks: [], agency: { id: 10 } })) } }
    }
    if (q === fareStopsQuery) {
      return { data: { stops: vars.ids.map((id: number) => stops[id]).filter(Boolean) } }
    }
    throw new Error('unexpected query')
  })
  const client: GraphQLClient = { query: query as any }
  return { client, query }
}

async function run (client: GraphQLClient, feedVersionRouteIds: Record<string, number[]>, routeStopIds: Record<number, number[]> = {}) {
  const events: ScenarioProgress[] = []
  await runFaresPhase({
    feedVersions: Object.keys(feedVersionRouteIds).map(sha1 => ({ feedOnestopId: `f-${sha1}`, feedVersionSha1: sha1 })),
    feedVersionRouteIds,
    routeStopIds,
  }, client, (e) => { events.push(e) })
  const summaries = new Map<number, RouteFareSummary>(events.flatMap(e => e.partialData?.routeFares || []))
  return { events, summaries }
}

describe('runFaresPhase', () => {
  it('emits a summary for each route of each feed version', async () => {
    const { client, query } = mockClient({
      a: fvFares({ fare_attributes: [{ id: 1, price: 2, currency_type: 'USD', agency: null }] }),
      b: fvFares({}),
    })
    const { events, summaries } = await run(client, { a: [1, 2], b: [3] })
    expect(summaries.get(1)).toMatchObject({ source: 'fares-v1', minAmount: 2, maxAmount: 2 })
    expect(summaries.get(2)).toMatchObject({ source: 'fares-v1', minAmount: 2 })
    expect(summaries.get(3)).toEqual({ source: 'none', flags: [] })
    // No fares in b, so no route lookup for it; no zone rules, so no stops at all.
    expect(query.mock.calls.filter(([q]) => q === fareRoutesQuery).map(([, v]) => v.ids)).toEqual([[1, 2]])
    expect(query.mock.calls.some(([q]) => q === fareStopsQuery)).toBe(false)
    expect(events.at(-1)?.phaseProgress).toEqual({ phase: 'fares', completed: 1, total: 1 })
  })

  it('fetches the scenario stops of a feed with zone rules', async () => {
    const { client, query } = mockClient({
      a: fvFares({
        fare_attributes: [
          { id: 1, price: 2, currency_type: 'USD', agency: null },
          { id: 2, price: 4, currency_type: 'USD', agency: null },
        ],
        fare_rules: [
          { fare_attribute: { id: 1 }, route: null, origin_id: '1', destination_id: null, contains_id: null },
          { fare_attribute: { id: 2 }, route: null, origin_id: '2', destination_id: null, contains_id: null },
        ],
      }),
    }, {
      100: { id: 100, zone_id: '1', areas: [], parent: null },
    })
    const { summaries } = await run(client, { a: [1] }, { 1: [100] })
    expect(query.mock.calls.find(([q]) => q === fareStopsQuery)?.[1].ids).toEqual([100])
    // Only zone 1 is served in the scenario.
    expect(summaries.get(1)).toMatchObject({ minAmount: 2, maxAmount: 2 })
  })

  it('prices flex routes, which have no scenario stops, without fetching stops for them', async () => {
    const { client, query } = mockClient({
      a: fvFares({
        fare_attributes: [{ id: 1, price: 1, currency_type: 'USD', agency: null }],
        fare_rules: [
          { fare_attribute: { id: 1 }, route: { id: 7 }, origin_id: null, destination_id: null, contains_id: null },
          { fare_attribute: { id: 1 }, route: null, origin_id: 'Z', destination_id: null, contains_id: null },
        ],
      }),
    })
    const { summaries } = await run(client, { a: [7] })
    expect(summaries.get(7)).toMatchObject({ minAmount: 1, maxAmount: 1, flags: ['zones-not-matched'] })
    expect(query.mock.calls.find(([q]) => q === fareStopsQuery)).toBeUndefined()
  })

  it('leaves a feed version\'s routes without summaries when its query fails', async () => {
    const query = vi.fn(async () => { throw new Error('boom') })
    const onError = vi.fn()
    const events: ScenarioProgress[] = []
    await runFaresPhase({
      feedVersions: [{ feedOnestopId: 'f', feedVersionSha1: 'a' }],
      feedVersionRouteIds: { a: [1] },
      routeStopIds: {},
    }, { query: query as any }, (e) => { events.push(e) }, { onError })
    expect(onError).toHaveBeenCalled()
    expect(events.some(e => e.partialData?.routeFares)).toBe(false)
  })
})
