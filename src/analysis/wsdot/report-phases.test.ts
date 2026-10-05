import { describe, it, expect, vi } from 'vitest'
import { runWsdotLevelGeometryPhase, type WSDOTProgress } from './report-phases'
import {
  apiFetch,
  BasicGraphQLClient,
  convertBbox,
  parseBbox,
  type GraphQLClient,
} from '~~/src/core'
import { stopQuery } from '~~/src/tl'

// The map overlay's on-demand outline fetch. The report's numbers come from
// the geographies phase and are pinned by report-goldens.test.ts; nothing here
// feeds a population rollup, so this is about the request and the stream.
//
// The integration suite needs the fixture services
// (`./docker/reset-test-services.sh`). Ungated, like scenario-census.test.ts.

const GEO_DATASET = 'tiger2021'
// Downtown Portland, OR — the same bbox the browse and WSDOT goldens use.
const BBOX = parseBbox('-122.69075,45.51358,-122.66809,45.53306')!

function polygon (x: number): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] }
}

// Answers every geography query with `count` outlines.
function outlineClient (count: number): GraphQLClient & { query: ReturnType<typeof vi.fn> } {
  const geographies = Array.from({ length: count }, (_, i) => ({ intersection_geometry: polygon(i) }))
  return { query: vi.fn().mockResolvedValue({ data: { census_datasets: [{ id: 1, geographies }] } }) }
}

function collect (): { emit: (p: WSDOTProgress) => void, events: WSDOTProgress[] } {
  const events: WSDOTProgress[] = []
  return { emit: p => void events.push(p), events }
}

describe('runWsdotLevelGeometryPhase', () => {
  it('fetches one clipped tract set per level and streams it', async () => {
    const client = outlineClient(3)
    const { emit, events } = collect()
    await runWsdotLevelGeometryPhase({
      geoDatasetName: GEO_DATASET,
      stopBufferRadius: 800,
      levels: [{ level: 'level1', stopIds: [1, 2] }, { level: 'levelAll', stopIds: [1, 2, 3] }],
    }, client, emit)

    expect(client.query).toHaveBeenCalledTimes(2)
    for (const [, variables] of client.query.mock.calls) {
      expect(variables.layer).toBe('tract')
      expect(variables.stopBufferRadius).toBe(800)
      expect(variables.geoDatasetName).toBe(GEO_DATASET)
    }
    expect(client.query.mock.calls[0]![1].stopIds).toEqual([1, 2])
    expect(client.query.mock.calls[1]![1].stopIds).toEqual([1, 2, 3])

    // Every outline reaches the consumer, tagged with the level that drew it.
    const byLevel: Record<string, number> = {}
    for (const event of events) {
      for (const chunk of event.partialData?.wsdotLevelGeometry || []) {
        byLevel[chunk.level] = (byLevel[chunk.level] || 0) + chunk.geometry.length
      }
    }
    expect(byLevel).toEqual({ level1: 3, levelAll: 3 })
  })

  it('closes its progress slice even with nothing to fetch', async () => {
    // A run at radius 0, or one where no stop qualified for any level, still
    // has to fill the slice — a 0/0 counter reads as a bar stuck at zero.
    for (const config of [
      { geoDatasetName: GEO_DATASET, stopBufferRadius: 0, levels: [{ level: 'level1', stopIds: [1] }] },
      { geoDatasetName: GEO_DATASET, stopBufferRadius: 800, levels: [{ level: 'level1', stopIds: [] }] },
    ]) {
      const client = outlineClient(1)
      const { emit, events } = collect()
      await runWsdotLevelGeometryPhase(config, client, emit)

      expect(client.query).not.toHaveBeenCalled()
      const done = events.filter(e => (e.phaseProgress?.total ?? 0) > 0
        && e.phaseProgress!.completed >= e.phaseProgress!.total)
      expect(done.length).toBeGreaterThan(0)
    }
  })
})

describe('runWsdotLevelGeometryPhase (integration)', () => {
  it('returns drawable outlines for a real stop set', async () => {
    const client = new BasicGraphQLClient(
      (process.env.TRANSITLAND_API_BASE || 'http://localhost:28080') + '/query',
      apiFetch(''),
    )
    const stops = await client.query<{ stops: { id: number }[] }>(stopQuery, {
      after: 0,
      limit: 1000,
      where: {
        location_type: 0,
        location: { bbox: convertBbox(BBOX), geography_ids: null },
      },
    })
    const stopIds = (stops.data?.stops || []).map(s => s.id)
    expect(stopIds.length).toBeGreaterThan(0)

    const { emit, events } = collect()
    await runWsdotLevelGeometryPhase({
      geoDatasetName: GEO_DATASET,
      stopBufferRadius: 800,
      levels: [{ level: 'levelAll', stopIds }],
    }, client, emit)

    const geometry = events.flatMap(e => e.partialData?.wsdotLevelGeometry || [])
      .flatMap(chunk => chunk.geometry)
    expect(geometry.length).toBeGreaterThan(0)
    for (const g of geometry) {
      expect(['Polygon', 'MultiPolygon']).toContain(g.type)
    }
  }, 120000)
})
