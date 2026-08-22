import { describe, it, expect, vi } from 'vitest'
import { gql } from 'graphql-tag'
import { runStopCensusPhase } from './stop-census'
import { apiFetch, BasicGraphQLClient, SCENARIO_DEFAULTS, type GraphQLClient } from '~~/src/core'
import type { ScenarioProgress } from '../scenario'

// The per-stop census phase. The hermetic suite pins the request shape — the
// batching and the single layer are what keep it off the stop query's critical
// path. The integration suite runs it against the fixture tlserver, which is
// the only check on the GraphQL shape; it is ungated, like buffer-passes.

function collect (): { emit: (p: ScenarioProgress) => void, events: ScenarioProgress[] } {
  const events: ScenarioProgress[] = []
  return { emit: p => void events.push(p), events }
}

// Echoes back one geography per requested stop id.
function echoClient (): GraphQLClient & { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn().mockImplementation((_q: any, v: any) => Promise.resolve({
      data: {
        stops: (v.ids as number[]).map(id => ({
          id,
          census_geographies: [{ id: id * 10, geoid: `g${id}`, layer_name: v.layer, name: `Area ${id}` }],
        })),
      },
    })),
  }
}

function streamedEntries (events: ScenarioProgress[]): [number, unknown][] {
  return events.flatMap(e => e.partialData?.stopCensusGeographies || [])
}

describe('runStopCensusPhase', () => {
  it('pages stop ids under the server limit and asks for one layer', async () => {
    // The root `stops` limit maxes out at 1000 and truncates silently above it,
    // so the ids have to be paged and the limit sent explicitly — it defaults
    // to 100 whether or not ids are given.
    const stopIds = Array.from({ length: 2500 }, (_, i) => i + 1)
    const client = echoClient()
    const { emit, events } = collect()
    await runStopCensusPhase({
      stopIds,
      geoDatasetName: 'tiger2021',
      censusLayer: 'tract',
    }, client, emit)

    expect(client.query).toHaveBeenCalledTimes(3)
    for (const [, variables] of client.query.mock.calls) {
      expect(variables.layer).toBe('tract')
      expect(variables.dataset).toBe('tiger2021')
      expect(variables.ids.length).toBeLessThanOrEqual(1000)
      expect(variables.limit).toBe(variables.ids.length)
    }
    expect(client.query.mock.calls.flatMap(([, v]) => v.ids)).toEqual(stopIds)
    expect(streamedEntries(events).map(([id]) => id)).toEqual(stopIds)
  })

  it('closes its progress slice with no stops to ask about', async () => {
    const client = echoClient()
    const { emit, events } = collect()
    await runStopCensusPhase({ stopIds: [], geoDatasetName: 'tiger2021', censusLayer: 'tract' }, client, emit)

    expect(client.query).not.toHaveBeenCalled()
    expect(events).toHaveLength(1)
    expect(events[0]?.phaseProgress).toEqual({ phase: 'stop-census', completed: 1, total: 1 })
  })

  it('emits an entry for a stop in no geography of the layer', async () => {
    // "None" has to be distinguishable from "not fetched": a stop outside every
    // place still belongs in the aggregation table's stop count.
    const client: GraphQLClient = {
      query: vi.fn().mockResolvedValue({ data: { stops: [{ id: 1, census_geographies: [] }] } }),
    }
    const { emit, events } = collect()
    await runStopCensusPhase({ stopIds: [1], geoDatasetName: 'tiger2021', censusLayer: 'place' }, client, emit)

    expect(streamedEntries(events)).toEqual([[1, []]])
  })
})

describe('runStopCensusPhase (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )

  // Downtown Portland — the bbox the browse and census goldens use.
  const discoverStopIdsQuery = gql`
    query ($limit: Int!) {
      stops(
        limit: $limit,
        where: {bbox: {min_lon: -122.69, min_lat: 45.513, max_lon: -122.668, max_lat: 45.533}}
      ) { id }
    }
  `

  it('returns the requested layer and nothing else', async () => {
    const discovered = await client.query<{ stops: { id: number }[] }>(discoverStopIdsQuery, { limit: 25 })
    const stopIds = (discovered.data?.stops ?? []).map(s => s.id)
    expect(stopIds.length).toBeGreaterThan(0)

    const { emit, events } = collect()
    await runStopCensusPhase({
      stopIds,
      geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
      censusLayer: 'tract',
    }, client, emit)

    const entries = streamedEntries(events) as [number, { layer_name: string, geoid: string }[]][]
    expect(entries.map(([id]) => id).sort()).toEqual([...stopIds].sort())
    const geographies = entries.flatMap(([, g]) => g)
    expect(geographies.length).toBeGreaterThan(0)
    for (const g of geographies) {
      expect(g.layer_name).toBe('tract')
      expect(g.geoid).toBeTruthy()
    }
  }, 120000)
})
