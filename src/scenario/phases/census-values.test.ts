import { describe, it, expect, vi } from 'vitest'
import type { GraphQLClient, CensusGeographyData } from '~~/src/core'
import { runCensusValuesPhase, type CensusValuesPhaseConfig } from './census-values'

// The phase runs three passes: the query-area pass supplies the row universe
// and ACS values, and the clip passes narrow each intersection to the query
// area AND the stop buffers, and to the query area outside them. Geographies a
// clip doesn't reach must survive at zero — the backend's composed clip is an
// inner join and drops them outright.

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

// The outside clip: the rest of 'served', and all of 'unserved'.
function outsideResponse () {
  return {
    data: {
      census_datasets: [{
        id: 1,
        geographies: [
          { geoid: 'served', intersection_area: 750 },
          { geoid: 'unserved', intersection_area: 1000 },
        ],
      }],
    },
  }
}

function baseConfig (overrides: Partial<CensusValuesPhaseConfig> = {}): CensusValuesPhaseConfig {
  return {
    bbox: BBOX,
    geoDatasetName: 'tiger2021',
    tableDatasetName: 'acsdt5y2021',
    aggregateLayer: 'tract',
    // Asked for, so most cases cover all three passes. The off case has a test
    // of its own.
    includeOutsideClip: true,
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
  it('keeps every clip so the choropleth can switch modes without refetching', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), outsideResponse()],
    )

    expect(query).toHaveBeenCalledTimes(3)
    // Both tracts survive — the unserved one is what the composed clip drops.
    expect([...geographies.keys()].sort()).toEqual(['served', 'unserved'])

    const served = geographies.get('served')!
    expect(served.intersectionArea).toBe(1000)
    expect(served.intersectionRatio).toBe(1)
    expect(served.bufferIntersectionArea).toBe(250)
    expect(served.bufferIntersectionRatio).toBe(0.25)
    expect(served.outsideIntersectionArea).toBe(750)
    expect(served.outsideIntersectionRatio).toBe(0.75)
    expect(served.values.b01003_001).toBe(500)

    // Reached by no buffer: present, with a zero buffer clip rather than a
    // missing one, so `buffer` mode shades it 0% instead of falling back.
    const unserved = geographies.get('unserved')!
    expect(unserved.intersectionArea).toBe(1000)
    expect(unserved.intersectionRatio).toBe(1)
    expect(unserved.bufferIntersectionArea).toBe(0)
    expect(unserved.bufferIntersectionRatio).toBe(0)
    expect(unserved.outsideIntersectionArea).toBe(1000)
    expect(unserved.outsideIntersectionRatio).toBe(1)
    expect(unserved.geometryArea).toBe(1000)
  })

  // The mirror of the unserved tract: wholly inside the buffers, so `outside`
  // mode shades it 0% instead of falling back to the query area.
  it('reports a geography the outside clip misses at zero', async () => {
    const { geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), {
        data: { census_datasets: [{ id: 1, geographies: [{ geoid: 'unserved', intersection_area: 1000 }] }] },
      }],
    )
    expect(geographies.get('served')!.outsideIntersectionArea).toBe(0)
    expect(geographies.get('served')!.outsideIntersectionRatio).toBe(0)
  })

  // Only the outside mode reads the outside clip, so its pass waits to be asked.
  it('runs the outside pass only when asked', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400, includeOutsideClip: false }),
      [queryAreaResponse(), clipResponse()],
    )
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1]![1].exclude).toBe(false)
    expect(geographies.get('served')!.bufferIntersectionRatio).toBe(0.25)
    expect(geographies.get('served')!.outsideIntersectionArea).toBeUndefined()
    expect(geographies.get('served')!.outsideIntersectionRatio).toBeUndefined()
  })

  it('leaves the stop-buffer clips undefined when the clip passes are skipped', async () => {
    const { geographies } = await runPhase(
      baseConfig({ stopIds: [], stopBufferRadius: 400 }),
      [queryAreaResponse()],
    )
    for (const geo of geographies.values()) {
      expect(geo.bufferIntersectionArea).toBeUndefined()
      expect(geo.bufferIntersectionRatio).toBeUndefined()
      expect(geo.outsideIntersectionArea).toBeUndefined()
      expect(geo.outsideIntersectionRatio).toBeUndefined()
    }
  })

  // Threading the stop buffer into pass 1 would collapse the row universe:
  // the backend's composed clip is an inner join.
  it('never sends a stop buffer on the query-area pass', async () => {
    const { query } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), outsideResponse()],
    )
    const pass1 = query.mock.calls[0]![1]
    expect(pass1.stopIds).toEqual([])
    expect(pass1.stopBufferRadius).toBeUndefined()
    // The clip passes target the same dataset and layer as pass 1, inside the
    // buffers and then outside them.
    for (const [i, exclude] of [[1, false], [2, true]] as const) {
      const pass = query.mock.calls[i]![1]
      expect(pass.geoDatasetName).toBe(pass1.geoDatasetName)
      expect(pass.layer).toBe(pass1.layer)
      expect(pass.stopIds).toEqual([1, 2])
      expect(pass.stopBufferRadius).toBe(400)
      expect(pass.exclude).toBe(exclude)
    }
  })

  it('skips the clip passes at radius 0 and keeps query-area intersections', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 0 }),
      [queryAreaResponse()],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(geographies.get('served')!.intersectionRatio).toBe(1)
    expect(geographies.get('unserved')!.intersectionRatio).toBe(1)
  })

  it('skips the clip passes when the scenario has no stops', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ stopIds: [], stopBufferRadius: 400 }),
      [queryAreaResponse()],
    )
    expect(query).toHaveBeenCalledTimes(1)
    expect(geographies.get('unserved')!.intersectionRatio).toBe(1)
  })

  // The passes once clipped against a bbox widened by the radius, which
  // measured every intersection against an area the user never drew and
  // returned geographies that don't touch the query at all.
  it('clips against the bbox as drawn, not one widened by the radius', async () => {
    const { query } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), outsideResponse()],
    )
    const drawn = { min_lon: -122.7, min_lat: 45.5, max_lon: -122.6, max_lat: 45.6 }
    expect(query).toHaveBeenCalledTimes(3)
    for (const call of query.mock.calls) {
      expect(call[1].bbox).toEqual(drawn)
    }
  })

  // Admin boundaries reach every pass in place of the bbox, which the server
  // would otherwise rank above them.
  it('clips against the geography ids in place of the bbox', async () => {
    const { query, geographies } = await runPhase(
      baseConfig({ geographyIds: [11, 12], stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), outsideResponse()],
    )
    expect(query).toHaveBeenCalledTimes(3)
    for (const call of query.mock.calls) {
      expect(call[1].geographyIds).toEqual([11, 12])
      expect(call[1].bbox).toBeUndefined()
    }
    expect(geographies.get('served')!.bufferIntersectionRatio).toBe(0.25)
    expect(geographies.get('unserved')!.bufferIntersectionRatio).toBe(0)
    expect(geographies.get('served')!.outsideIntersectionRatio).toBe(0.75)
  })

  // The outlines roughly double the response, so nothing fetches them unless
  // a mode is actually drawing the clipped footprint.
  it('fetches clipped outlines only when asked, on every pass', async () => {
    const { query: without } = await runPhase(
      baseConfig({ stopIds: [1, 2], stopBufferRadius: 400 }),
      [queryAreaResponse(), clipResponse(), outsideResponse()],
    )
    expect(without.mock.calls[0]![1].includeIntersectionGeometry).toBe(false)
    expect(without.mock.calls[1]![1].includeGeometry).toBe(false)
    expect(without.mock.calls[2]![1].includeGeometry).toBe(false)

    const queryAreaGeom = { type: 'Polygon', coordinates: [[[0, 0]]] }
    const bufferGeom = { type: 'Polygon', coordinates: [[[1, 1]]] }
    const outsideGeom = { type: 'Polygon', coordinates: [[[2, 2]]] }
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
      }, {
        data: {
          census_datasets: [{
            id: 1,
            geographies: [{ geoid: 'served', intersection_area: 750, intersection_geometry: outsideGeom }],
          }],
        },
      }],
    )
    expect(with_.mock.calls[0]![1].includeIntersectionGeometry).toBe(true)
    expect(with_.mock.calls[1]![1].includeGeometry).toBe(true)
    expect(with_.mock.calls[2]![1].includeGeometry).toBe(true)

    const served = geographies.get('served')!
    expect(served.intersectionGeometry).toEqual(queryAreaGeom)
    expect(served.bufferIntersectionGeometry).toEqual(bufferGeom)
    expect(served.outsideIntersectionGeometry).toEqual(outsideGeom)
    // Reached by no buffer: still zero area, and no outline to draw.
    expect(geographies.get('unserved')!.bufferIntersectionGeometry).toBeUndefined()
  })

  // Pass 1's values must survive a failing clip: the clips are enhancements,
  // not preconditions for the scenario, and each fails on its own.
  it('keeps query-area values and the other clip when a clip pass fails', async () => {
    const query = vi.fn()
    query.mockResolvedValueOnce(queryAreaResponse())
    query.mockRejectedValueOnce(new Error('statement timeout'))
    query.mockResolvedValueOnce(outsideResponse())
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
    expect(geographies.get('served')!.outsideIntersectionArea).toBe(750)
  })
})
