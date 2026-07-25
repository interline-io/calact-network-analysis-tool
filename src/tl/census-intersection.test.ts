import { describe, it, expect, vi } from 'vitest'
import type { GraphQLClient } from '~~/src/core'
import { fetchCensusIntersection, fetchClipIntersections } from './census-intersection'

// The GraphQL variables these two functions build are the whole contract with
// the backend's filter-precedence chain: `bbox` outranks everything, and
// `within` + `stop_buffer` only compose with a positive radius. Nothing else
// in the suite asserts them, so a wire-shape regression is otherwise silent.

function mockClient (response: any) {
  const query = vi.fn().mockResolvedValue(response)
  return { client: { query } as unknown as GraphQLClient, query }
}

const WITHIN: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[-122.7, 45.5], [-122.6, 45.5], [-122.6, 45.6], [-122.7, 45.6], [-122.7, 45.5]]],
}

const BBOX = { sw: { lon: -122.7, lat: 45.5 }, ne: { lon: -122.6, lat: 45.6 }, valid: true }

function geographiesResponse (geographies: any[]) {
  return { data: { census_datasets: [{ id: 1, name: 'tiger2021', url: '', geographies }] } }
}

describe('fetchCensusIntersection variables', () => {
  const base = {
    geoDatasetName: 'tiger2021',
    geoDatasetLayer: 'tract',
    tableDatasetName: 'acsdt5y2021',
    tableNames: ['b01003'],
  }

  it('omits bbox when a within polygon is supplied', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    await fetchCensusIntersection({ ...base, client, bbox: BBOX, within: WITHIN })
    const vars = query.mock.calls[0]![1]
    expect(vars.within).toBe(WITHIN)
    expect(vars.bbox).toBeUndefined()
  })

  it('sends bbox when no within polygon is supplied', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    await fetchCensusIntersection({ ...base, client, bbox: BBOX })
    const vars = query.mock.calls[0]![1]
    expect(vars.bbox).toEqual({ min_lon: -122.7, min_lat: 45.5, max_lon: -122.6, max_lat: 45.6 })
    expect(vars.within).toBeUndefined()
  })

  it('passes the stop buffer through alongside within', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    await fetchCensusIntersection({ ...base, client, within: WITHIN, stopIds: [7, 8], stopBufferRadius: 400 })
    const vars = query.mock.calls[0]![1]
    expect(vars.within).toBe(WITHIN)
    expect(vars.stopIds).toEqual([7, 8])
    expect(vars.stopBufferRadius).toBe(400)
  })
})

describe('fetchClipIntersections', () => {
  const base = {
    geoDatasetName: 'tiger2021',
    geoDatasetLayer: 'tract',
    within: WITHIN,
  }

  it('sends within and the stop buffer together', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    await fetchClipIntersections({ ...base, client, stopIds: [1, 2, 3], stopBufferRadius: 400 })
    expect(query).toHaveBeenCalledTimes(1)
    const vars = query.mock.calls[0]![1]
    expect(vars).toMatchObject({
      geoDatasetName: 'tiger2021',
      layer: 'tract',
      within: WITHIN,
      stopIds: [1, 2, 3],
      stopBufferRadius: 400,
    })
  })

  // Radius 0 routes the backend to point matching, which never selects
  // intersection_area — the field comes back null and would zero every ratio.
  it('makes no request at radius 0', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    const clips = await fetchClipIntersections({ ...base, client, stopIds: [1], stopBufferRadius: 0 })
    expect(query).not.toHaveBeenCalled()
    expect(clips.size).toBe(0)
  })

  it('makes no request with an empty stop set', async () => {
    const { client, query } = mockClient(geographiesResponse([]))
    const clips = await fetchClipIntersections({ ...base, client, stopIds: [], stopBufferRadius: 400 })
    expect(query).not.toHaveBeenCalled()
    expect(clips.size).toBe(0)
  })

  it('keys areas by geoid and sums repeated rows', async () => {
    const { client } = mockClient(geographiesResponse([
      { geoid: 'A', intersection_area: 100, intersection_geometry: null },
      { geoid: 'B', intersection_area: 250, intersection_geometry: null },
      { geoid: 'A', intersection_area: 50, intersection_geometry: null },
    ]))
    const clips = await fetchClipIntersections({ ...base, client, stopIds: [1], stopBufferRadius: 400 })
    expect(clips.get('A')?.area).toBe(150)
    expect(clips.get('B')?.area).toBe(250)
    expect(clips.has('C')).toBe(false)
  })

  it('treats a null intersection_area as zero', async () => {
    const { client } = mockClient(geographiesResponse([{ geoid: 'A', intersection_area: null, intersection_geometry: null }]))
    const clips = await fetchClipIntersections({ ...base, client, stopIds: [1], stopBufferRadius: 400 })
    expect(clips.get('A')?.area).toBe(0)
  })

  // The geometry is what the map draws for the buffer-coverage layer.
  it('carries the clipped geometry through', async () => {
    const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
    const { client } = mockClient(geographiesResponse([{ geoid: 'A', intersection_area: 100, intersection_geometry: geometry }]))
    const clips = await fetchClipIntersections({ ...base, client, stopIds: [1], stopBufferRadius: 400 })
    expect(clips.get('A')?.geometry).toEqual(geometry)
  })
})
