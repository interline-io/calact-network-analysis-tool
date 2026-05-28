import { describe, it, expect } from 'vitest'
import { gql } from 'graphql-tag'
import { apiFetch, BasicGraphQLClient, SCENARIO_DEFAULTS } from '~~/src/core'
import { runBufferPasses } from './buffer-passes'
import type { ScenarioProgress } from './scenario'

// Integration tests for the buffer-only fetch path (#315 Passes C/D/E/F).
// Hits a live transitland-server connected to the test DB. Gate is opt-in so
// CI without a server doesn't fail; run locally with:
//   TEST_BUFFER=true TRANSITLAND_API_BASE=http://localhost:8080 pnpm test
describe.skipIf(process.env.TEST_BUFFER !== 'true')('runBufferPasses (integration)', () => {
  const client = new BasicGraphQLClient(
    (process.env.TRANSITLAND_API_BASE || '') + '/query',
    apiFetch(process.env.TRANSITLAND_API_KEY || ''),
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

  it('returns no events for empty id sets', async () => {
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
    expect(events).toHaveLength(0)
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

    const stopEvents = events.filter(e => e.currentStage === 'stop-buffer-geographies')
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
    const aggEvent = events.find(e => e.currentStage === 'aggregation-buffer-geographies')
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
      if (p.currentStage === 'stop-buffer-geographies') {
        for (const [, geos] of p.partialData!.stopBufferGeographies!) {
          perStopGeographyCount += geos.length
        }
      }
    })

    const aggEvent = events.find(e => e.currentStage === 'aggregation-buffer-geographies')!
    // Union over neighbouring stops in downtown PDX necessarily produces
    // fewer total tract rows than naively summing per-stop tract lists
    // (overlapping buffers share tracts).
    expect(aggEvent.partialData!.aggregationBufferGeographies!.length)
      .toBeLessThan(perStopGeographyCount)
  })
})
