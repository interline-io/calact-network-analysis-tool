import { describe, it, expect, vi, type Mock } from 'vitest'
import type { Bbox, GraphQLClient } from '~~/src/core'
import { runCensusValuesPass, resolveScenarioArea } from './census-values-pass'
import type { ScenarioProgress } from './scenario'

// Unit tests for the census-values pass + area resolution. The intersection
// fetcher tolerates empty GraphQL responses, so a mock client is enough.
class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock = vi.fn().mockResolvedValue({ data: {} })

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

const testBbox: Bbox = {
  sw: { lon: -122.69, lat: 45.51 },
  ne: { lon: -122.66, lat: 45.53 },
  valid: true,
}

function baseConfig (overrides: Record<string, unknown> = {}) {
  return {
    geoDatasetName: 'tiger2024',
    tableDatasetName: 'acsdt5y2021',
    layer: 'tract',
    bbox: testBbox,
    ...overrides,
  }
}

describe('runCensusValuesPass', () => {
  it('skips without a resolved bbox', async () => {
    const client = new MockGraphQLClient()
    const events: ScenarioProgress[] = []
    await runCensusValuesPass(baseConfig({ bbox: undefined }), client, p => events.push(p))
    expect(events).toHaveLength(0)
    expect(client.mockQuery).not.toHaveBeenCalled()
  })

  it('emits a start event and a censusGeographies data event', async () => {
    const client = new MockGraphQLClient()
    const events: ScenarioProgress[] = []
    await runCensusValuesPass(baseConfig(), client, p => events.push(p))

    expect(events).toHaveLength(2)
    expect(events.every(e => e.currentStage === 'census-values')).toBe(true)
    expect(events[0]!.partialData).toBeUndefined()
    expect(events[1]!.partialData?.censusGeographies).toEqual([])
    expect(client.mockQuery).toHaveBeenCalledTimes(1)
  })

  it('pads the bbox by the stop buffer radius', async () => {
    const client = new MockGraphQLClient()
    await runCensusValuesPass(baseConfig({ stopBufferRadius: 400 }), client, () => {})

    const vars = client.mockQuery.mock.calls[0]![1]
    // Padded bbox extends beyond the input on every side.
    expect(vars.bbox.min_lon).toBeLessThan(testBbox.sw.lon)
    expect(vars.bbox.min_lat).toBeLessThan(testBbox.sw.lat)
    expect(vars.bbox.max_lon).toBeGreaterThan(testBbox.ne.lon)
    expect(vars.bbox.max_lat).toBeGreaterThan(testBbox.ne.lat)
  })

  it('uses the bbox unpadded when radius is 0', async () => {
    const client = new MockGraphQLClient()
    await runCensusValuesPass(baseConfig({ stopBufferRadius: 0 }), client, () => {})

    const vars = client.mockQuery.mock.calls[0]![1]
    expect(vars.bbox.min_lon).toBe(testBbox.sw.lon)
    expect(vars.bbox.max_lat).toBe(testBbox.ne.lat)
  })

  it('stamps the configured layer onto each entry', async () => {
    const client = new MockGraphQLClient()
    client.mockQuery.mockResolvedValue({
      data: {
        census_datasets: [{
          geographies: [{
            id: 1,
            geoid: '41051001',
            name: 'Tract 1',
            geometry_area: 100,
            intersection_area: 50,
            values: [],
          }],
        }],
      },
    })
    const events: ScenarioProgress[] = []
    await runCensusValuesPass(baseConfig({ layer: 'county' }), client, p => events.push(p))

    const entries = events[1]!.partialData!.censusGeographies!
    expect(entries).toHaveLength(1)
    expect(entries[0]![0]).toBe('41051001')
    expect(entries[0]![1].layer).toBe('county')
  })
})

describe('resolveScenarioArea', () => {
  it('passes through an explicit bbox with no within polygon', async () => {
    const client = new MockGraphQLClient()
    const resolved = await resolveScenarioArea(client, { bbox: testBbox, geoDatasetName: 'tiger2024' })
    expect(resolved.bbox).toEqual(testBbox)
    expect(resolved.within).toBeUndefined()
    expect(client.mockQuery).not.toHaveBeenCalled()
  })

  it('computes bbox + within from admin boundary geometry', async () => {
    const client = new MockGraphQLClient()
    const square: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
    }
    client.mockQuery.mockResolvedValue({
      data: { census_datasets: [{ geographies: [{ geometry: square }] }] },
    })
    const resolved = await resolveScenarioArea(client, { geographyIds: [42], geoDatasetName: 'tiger2024' })

    expect(resolved.bbox).toEqual({ sw: { lon: 0, lat: 0 }, ne: { lon: 2, lat: 2 }, valid: true })
    expect(resolved.within).toEqual(square)
  })

  it('picks the largest part of a MultiPolygon as within', async () => {
    const client = new MockGraphQLClient()
    const small = [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]]
    const large = [[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]]]
    client.mockQuery.mockResolvedValue({
      data: {
        census_datasets: [{
          geographies: [{ geometry: { type: 'MultiPolygon', coordinates: [small, large] } }],
        }],
      },
    })
    const resolved = await resolveScenarioArea(client, { geographyIds: [42], geoDatasetName: 'tiger2024' })

    expect(resolved.within).toEqual({ type: 'Polygon', coordinates: large })
  })
})
