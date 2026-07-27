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
  it('keeps both clips so the choropleth can switch modes without refetching', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )

    expect(query).toHaveBeenCalledTimes(2)
    // Both tracts survive — the unserved one is what the composed clip drops.
    expect([...geographies.keys()].sort()).toEqual(['served', 'unserved'])

    const served = geographies.get('served')!
    expect(served.intersectionArea).toBe(1000)
    expect(served.intersectionRatio).toBe(1)
    expect(served.bufferIntersectionArea).toBe(250)
    expect(served.bufferIntersectionRatio).toBe(0.25)
    expect(served.values.b01003_001).toBe(500)

    // Reached by no buffer: present, with a zero buffer clip rather than a
    // missing one, so `buffer` mode shades it 0% instead of falling back.
    const unserved = geographies.get('unserved')!
    expect(unserved.intersectionArea).toBe(1000)
    expect(unserved.intersectionRatio).toBe(1)
    expect(unserved.bufferIntersectionArea).toBe(0)
    expect(unserved.bufferIntersectionRatio).toBe(0)
    expect(unserved.geometryArea).toBe(1000)
  })

  it('leaves the buffer clip undefined when the clip pass is skipped', async () => {
    const { geographies } = await runPhase(
      baseConfig({ stopIds: [], stopBufferRadius: 400 }),
      [queryAreaResponse()],
    )
    for (const geo of geographies.values()) {
      expect(geo.bufferIntersectionArea).toBeUndefined()
      expect(geo.bufferIntersectionRatio).toBeUndefined()
    }
  })

  // Threading the stop buffer into pass 1 would collapse the row universe:
  // the backend's composed clip is an inner join.
  it('never sends a stop buffer on the query-area pass', async () => {
    const { query } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )
    const pass1 = query.mock.calls[0]![1]
    expect(pass1.stopIds).toEqual([])
    expect(pass1.stopBufferRadius).toBeUndefined()
    // Pass 2 targets the same dataset and layer as pass 1.
    const pass2 = query.mock.calls[1]![1]
    expect(pass2.geoDatasetName).toBe(pass1.geoDatasetName)
    expect(pass2.layer).toBe(pass1.layer)
    expect(pass2.stopIds).toEqual([1, 2])
    expect(pass2.stopBufferRadius).toBe(400)
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

  // Both passes once clipped against a bbox widened by the radius, which
  // measured every intersection against an area the user never drew and
  // returned geographies that don't touch the query at all.
  it('clips against the bbox as drawn, not one widened by the radius', async () => {
    const { query } = await runPhase(
      baseConfig({ within: undefined, stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )
    const drawn = { min_lon: -122.7, min_lat: 45.5, max_lon: -122.6, max_lat: 45.6 }
    expect(query.mock.calls[0]![1].bbox).toEqual(drawn)
    expect(query.mock.calls[1]![1].bbox).toEqual(drawn)
  })

  // The backend composes a bbox with a stop buffer, so a bbox-only scenario
  // clips too — it does not need an admin boundary.
  it('clips against a bbox when no within polygon is given', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ within: undefined, stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1]![1].bbox).toBeDefined()
    expect(query.mock.calls[1]![1].within).toBeUndefined()
    expect(geographies.get('served')!.bufferIntersectionRatio).toBe(0.25)
    expect(geographies.get('unserved')!.bufferIntersectionRatio).toBe(0)
  })

  // The outlines roughly double the response, so nothing fetches them unless
  // a mode is actually drawing the clipped footprint.
  it('fetches clipped outlines only when asked, on both passes', async () => {
    const { query: without } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse()],
    )
    expect(without.mock.calls[0]![1].includeIntersectionGeometry).toBe(false)
    expect(without.mock.calls[1]![1].includeGeometry).toBe(false)

    const queryAreaGeom = { type: 'Polygon', coordinates: [[[0, 0]]] }
    const bufferGeom = { type: 'Polygon', coordinates: [[[1, 1]]] }
    const pass1 = queryAreaResponse()
    pass1.data.census_datasets[0]!.geographies[0]!.intersection_geometry = queryAreaGeom as any
    const { query: with_, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400, includeIntersectionGeometry: true }),
      [pass1, {
        data: {
          census_datasets: [{
            id: 1,
            geographies: [{ geoid: 'served', intersection_area: 250, intersection_geometry: bufferGeom }],
          }],
        },
      }],
    )
    expect(with_.mock.calls[0]![1].includeIntersectionGeometry).toBe(true)
    expect(with_.mock.calls[1]![1].includeGeometry).toBe(true)

    const served = geographies.get('served')!
    expect(served.intersectionGeometry).toEqual(queryAreaGeom)
    expect(served.bufferIntersectionGeometry).toEqual(bufferGeom)
    // Reached by no buffer: still zero area, and no outline to draw.
    expect(geographies.get('unserved')!.bufferIntersectionGeometry).toBeUndefined()
  })

  // Pass 1's values must survive a failing clip: the clip is an enhancement,
  // not a precondition for the scenario.
  it('keeps query-area values when the clip pass fails', async () => {
    const query = vi.fn()
    query.mockResolvedValueOnce(queryAreaResponse())
    query.mockRejectedValueOnce(new Error('statement timeout'))
    const client = { query } as unknown as GraphQLClient
    const emitted: [string, CensusGeographyData][] = []
    await runCensusValuesPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      client,
      (p) => {
        if (p.partialData?.censusGeographies) {
          emitted.push(...p.partialData.censusGeographies as [string, CensusGeographyData][])
        }
      },
    )
    const geographies = new Map(emitted)
    expect(geographies.size).toBe(2)
    expect(geographies.get('served')!.values.b01003_001).toBe(500)
    expect(geographies.get('served')!.intersectionRatio).toBe(1)
    expect(geographies.get('served')!.bufferIntersectionArea).toBeUndefined()
  })
})
