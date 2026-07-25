import { describe, it, expect, vi } from 'vitest'
import type { GraphQLClient, CensusGeographyData } from '~~/src/core'
import { runCensusValuesPhase, type CensusValuesPhaseConfig } from './census-values'

// The phase runs two passes: the query-area pass supplies the row universe and
// ACS values, and the clip pass narrows each intersection to the query area AND
// the stop buffers. Geographies the buffers don't reach must survive at zero —
// the backend's composed clip is an inner join and drops them outright.

const WITHIN: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[-122.7, 45.5], [-122.6, 45.5], [-122.6, 45.6], [-122.7, 45.6], [-122.7, 45.5]]],
}

const BBOX = { sw: { lon: -122.7, lat: 45.5 }, ne: { lon: -122.6, lat: 45.6 }, valid: true }

// Two tracts, each 1000 m², both fully inside the query area.
function queryAreaResponse () {
  return {
    data: {
      census_datasets: [{
        id: 1,
        name: 'tiger2021',
        url: '',
        geographies: ['served', 'unserved'].map((geoid, i) => ({
          id: 100 + i,
          name: `Tract ${geoid}`,
          aland: 0,
          awater: 0,
          geoid,
          layer_name: 'tract',
          adm0_name: 'United States',
          adm0_iso: 'US',
          adm1_name: 'Oregon',
          adm1_iso: 'US-OR',
          geometry_area: 1000,
          intersection_area: 1000,
          intersection_geometry: null,
          values: [{ dataset_name: 'acsdt5y2021', geoid, values: { b01003_001: 500 } }],
        })),
      }],
    },
  }
}

// Only 'served' overlaps the buffers, at a quarter of its area.
function clipResponse () {
  return {
    data: {
      census_datasets: [{ id: 1, geographies: [{ geoid: 'served', intersection_area: 250 }] }],
    },
  }
}

function baseConfig (overrides: Partial<CensusValuesPhaseConfig> = {}): CensusValuesPhaseConfig {
  return {
    within: WITHIN,
    bbox: BBOX,
    geoDatasetName: 'tiger2021',
    tableDatasetName: 'acsdt5y2021',
    aggregateLayer: 'tract',
    ...overrides,
  }
}

async function runPhase (config: CensusValuesPhaseConfig, responses: any[]) {
  const query = vi.fn()
  for (const r of responses) { query.mockResolvedValueOnce(r) }
  const client = { query } as unknown as GraphQLClient
  const emitted: [string, CensusGeographyData][] = []
  await runCensusValuesPhase(config, client, (p) => {
    if (p.partialData?.censusGeographies) {
      emitted.push(...p.partialData.censusGeographies as [string, CensusGeographyData][])
    }
  })
  return { query, geographies: new Map(emitted) }
}

describe('runCensusValuesPhase stop-buffer clipping', () => {
  it('narrows intersections to the buffers while keeping the query-area universe', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )

    expect(query).toHaveBeenCalledTimes(2)
    // Both tracts survive — the unserved one is what the composed clip drops.
    expect([...geographies.keys()].sort()).toEqual(['served', 'unserved'])

    const served = geographies.get('served')!
    expect(served.intersectionArea).toBe(250)
    expect(served.intersectionRatio).toBe(0.25)
    // ACS values still come from the query-area pass.
    expect(served.values.b01003_001).toBe(500)

    const unserved = geographies.get('unserved')!
    expect(unserved.intersectionArea).toBe(0)
    expect(unserved.intersectionRatio).toBe(0)
    expect(unserved.geometryArea).toBe(1000)
    expect(unserved.values.b01003_001).toBe(500)
  })

  it('skips the clip pass at radius 0 and keeps query-area intersections', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 0 }),
      [queryAreaResponse()],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(geographies.get('served')!.intersectionRatio).toBe(1)
    expect(geographies.get('unserved')!.intersectionRatio).toBe(1)
  })

  it('skips the clip pass when the scenario has no stops', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [], stopBufferRadius: 400 }),
      [queryAreaResponse()],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(geographies.get('unserved')!.intersectionRatio).toBe(1)
  })

  // The backend ignores a stop buffer whenever a bbox is present, so a
  // bbox-only scenario must not pretend to have clipped.
  it('skips the clip pass without a within polygon', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ within: undefined, stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse()],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(geographies.get('unserved')!.intersectionRatio).toBe(1)
  })
})
