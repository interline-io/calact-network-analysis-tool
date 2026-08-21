import { describe, it, expect } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient, SCENARIO_DEFAULTS } from '~~/src/core'
import { runBufferPasses } from './buffer-passes'
import type { ScenarioProgress } from '../scenario'

// Integration tests for the buffer-only fetch path (#315 Passes C/D/E/F).
// Hits a live transitland-server connected to the test DB, ungated like
// scenario-census.test.ts: CI stands the services up, and locally they come
// from ./docker/reset-test-services.sh.
//
// Previously behind TEST_BUFFER, which nothing set — so it never ran anywhere
// and its first case had gone stale against the phase-progress work.
describe('runBufferPasses (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
    apiFetch(''),
  )

  // Small bbox over downtown Portland — has multiple agencies, dozens of
  // stops, and intersects several census tracts in the test fixtures.
  const discoverStopIdsQuery = gql`
    query ($limit: Int!) {
      stops(
        limit: $limit,
        where: {bbox: {min_lon: -122.69, min_lat: 45.513, max_lon: -122.668, max_lat: 45.533}}
      ) { id }
    }
  `

  async function discoverStopIds (limit = 5): Promise<number[]> {
    const result = await client.query<{ stops: { id: number }[] }>(
      discoverStopIdsQuery, { limit },
    )
    return (result.data?.stops ?? []).map(s => s.id)
  }

  it('emits only a phase-done tick for empty id sets', async () => {
    const events: ScenarioProgress[] = []
    await runBufferPasses({
      radius: 400,
      layer: 'tract',
      geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
      tableDatasetName: SCENARIO_DEFAULTS.tableDatasetName!,
      stopIds: [],
      routeIds: [],
      agencyIds: [],
    }, client, p => events.push(p))
    // A phase whose queue ends up empty still reports itself done, so its
    // slice of the loading progress fills rather than sitting at zero. What it
    // must not do is emit demographics for stops nobody asked about.
    expect(events).toHaveLength(1)
    expect(events[0]?.phaseProgress).toEqual({ phase: 'buffers', completed: 1, total: 1 })
    expect(events[0]?.partialData).toBeUndefined()
  })

  it('emits per-stop and aggregation events for a real stop set', async () => {
    const stopIds = await discoverStopIds(5)
    expect(stopIds.length).toBeGreaterThan(0)

    const events: ScenarioProgress[] = []
    await runBufferPasses({
      radius: 400,
      layer: 'tract',
      geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
      tableDatasetName: SCENARIO_DEFAULTS.tableDatasetName!,
      stopIds,
      routeIds: [],
      agencyIds: [],
    }, client, p => events.push(p))

    // Chunks emit a data event and a progress tick; only the former carries results.
    const stopEvents = events.filter(e => e.partialData?.stopBufferGeographies)
    expect(stopEvents.length).toBeGreaterThan(0)

    // Each emitted chunk reports tracts for the input stops, by stop id.
    const seenStopIds = new Set<number>()
    for (const e of stopEvents) {
      for (const [id, geos] of e.partialData!.stopBufferGeographies!) {
        seenStopIds.add(id)
        expect(geos.length).toBeGreaterThan(0)
        expect(geos[0]!.geometryArea).toBeGreaterThan(0)
      }
    }
    expect([...seenStopIds].sort()).toEqual([...stopIds].sort())

    // Pass F runs whenever stopIds is non-empty.
    const aggEvent = events.find(e => e.partialData?.aggregationBufferGeographies)
    expect(aggEvent).toBeDefined()
    const aggTracts = aggEvent!.partialData!.aggregationBufferGeographies!
    expect(aggTracts.length).toBeGreaterThan(0)
  })

  it('aggregation total ≤ sum of per-stop tracts (union dedupes overlaps)', async () => {
    const stopIds = await discoverStopIds(8)
    expect(stopIds.length).toBeGreaterThan(1)

    let perStopGeographyCount = 0
    const events: ScenarioProgress[] = []
    await runBufferPasses({
      radius: 400,
      layer: 'tract',
      geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
      tableDatasetName: SCENARIO_DEFAULTS.tableDatasetName!,
      stopIds,
      routeIds: [],
      agencyIds: [],
    }, client, (p) => {
      events.push(p)
      if (p.partialData?.stopBufferGeographies) {
        for (const [, geos] of p.partialData.stopBufferGeographies) {
          perStopGeographyCount += geos.length
        }
      }
    })

    const aggEvent = events.find(e => e.partialData?.aggregationBufferGeographies)!
    // Union over neighbouring stops in downtown PDX necessarily produces
    // fewer total tract rows than naively summing per-stop tract lists
    // (overlapping buffers share tracts).
    expect(aggEvent.partialData!.aggregationBufferGeographies!.length)
      .toBeLessThan(perStopGeographyCount)
  })
})
